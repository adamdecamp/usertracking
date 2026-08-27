from __future__ import annotations

import csv
import hashlib
import io
import json
import shutil
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from html import escape as xml_escape
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DecodedStreamObject, DictionaryObject, NameObject, TextStringObject
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


ROOT = Path(__file__).resolve().parents[1]
WORK_ROOT = ROOT / "tmp" / "pdfs" / "t5"
PACKAGE_ROOT = WORK_ROOT / "P"
ARCHIVE_ROOT_NAME = "ISUT_500_User_Robust_Test_Package"
SCAN_ROOT = PACKAGE_ROOT / "01_DirectoryScan_Main"
MANUAL_ROOT = PACKAGE_ROOT / "02_Manual_Upload_Samples"
DELTA_ROOT = PACKAGE_ROOT / "03_Second_Sync_Changes"
BOUNDARY_ROOT = PACKAGE_ROOT / "B"
EXPECTED_ROOT = PACKAGE_ROOT / "Expected_Results"
OUTPUT_ROOT = ROOT / "output" / "pdf"
OUTPUT_ZIP = OUTPUT_ROOT / "Information-System-User-Tracker-500-User-Robust-Test-Package.zip"
OUTPUT_GUIDE = OUTPUT_ROOT / "Information-System-User-Tracker-500-User-Test-Guide.pdf"
AS_OF = date.today()

FIRST_NAMES = [
    "Avery", "Blake", "Casey", "Drew", "Emery", "Finley", "Gray", "Harper", "Indigo", "Jordan",
    "Kai", "Logan", "Morgan", "Noel", "Parker", "Quinn", "Riley", "Sage", "Taylor", "Vivian",
    "Wyatt", "Xavier", "Yasmin", "Zoe", "Anne-Marie",
]
LAST_NAMES = [
    "Adams", "Baker", "Brown", "Carter", "Diaz", "Evans", "Foster", "Garcia", "Hill", "Irwin",
    "Jones", "Kim", "Lewis", "Moore", "Nelson", "O'Neill", "Price", "Reed", "Smith-Jones", "Turner",
]
ORGANIZATIONS = [
    "GOV", "LM", "Boeing", "USAF", "USSF", "Navy", "Army", "Marines", "Northrop Grumman",
    "Raytheon", "MITRE", "CACI", "Leidos", "SAIC", "Contractor 42",
]
PRIVILEGED_TYPES = ["DADM", "ADM", "PADM", "CYBER", "DTA", "DEV", "CDA", "CCL"]
DATE_STYLES = [
    "DDMMMYYYY", "YYYYMMDD", "MMDDYYYY", "MMMDDYYYY", "MMDDYY", "DD-MMM-YYYY",
    "YYYY-MM-DD", "MM.DD.YYYY", "DD-MMM-YY", "MMM-DD-YY", "YYMMDD",
]
FILENAME_STYLES = [
    "Underscores", "Comma And Spaces", "Spaces", "Mixed Separators", "Extra Spaces",
    "Lowercase Keywords", "Reordered Keywords", "Extra Benign Tokens",
]

BASE_ARTIFACTS = ["SAAR", "DoD Cyber Cert", "GEN User Agreement"]
PRIV_ARTIFACTS = ["GEN and PRIV Agreement", "8140 Cert Memo", "Privileged User Training Cert"]
DTA_ARTIFACTS = ["DTA Training Cert", "DTA Agreement"]


@dataclass(frozen=True)
class User:
    index: int
    last: str
    first: str
    organization: str
    role: str
    privileged_type: str
    email: str


def safe_email_part(value: str) -> str:
    return "".join(character.lower() for character in value if character.isalnum() or character in ".-").strip(".-")


def add_year(value: date) -> date:
    try:
        return value.replace(year=value.year + 1)
    except ValueError:
        return value.replace(year=value.year + 1, day=28)


def evidence_date_for(offset_days: int) -> date:
    due = AS_OF + timedelta(days=offset_days)
    try:
        return due.replace(year=due.year - 1)
    except ValueError:
        return due.replace(year=due.year - 1, day=28)


STATUS_DATES = {
    "Current": AS_OF - timedelta(days=45),
    "Due Today": evidence_date_for(0),
    "Due In 7 Days": evidence_date_for(7),
    "Due In 15 Days": evidence_date_for(15),
    "Due In 30 Days": evidence_date_for(30),
    "Overdue 7 Days": evidence_date_for(-7),
    "Overdue 45 Days": evidence_date_for(-45),
    "Overdue 75 Days": evidence_date_for(-75),
    "Overdue 120 Days": evidence_date_for(-120),
}


def required_artifacts(user: User) -> list[str]:
    artifacts = list(BASE_ARTIFACTS)
    if user.role == "Privileged":
        artifacts.extend(PRIV_ARTIFACTS)
        if user.privileged_type == "DTA":
            artifacts.extend(DTA_ARTIFACTS)
    return artifacts


def date_text(value: date, style: str) -> str:
    formats = {
        "DDMMMYYYY": "%d%b%Y",
        "YYYYMMDD": "%Y%m%d",
        "MMDDYYYY": "%m%d%Y",
        "MMMDDYYYY": "%b%d%Y",
        "MMDDYY": "%m%d%y",
        "DD-MMM-YYYY": "%d-%b-%Y",
        "YYYY-MM-DD": "%Y-%m-%d",
        "MM.DD.YYYY": "%m.%d.%Y",
        "DD-MMM-YY": "%d-%b-%y",
        "MMM-DD-YY": "%b-%d-%y",
        "YYMMDD": "%y%m%d",
    }
    return value.strftime(formats[style]).upper()


def normalized_date(value: date) -> str:
    return value.strftime("%d%b%Y").upper()


def expected_status(kind: str, evidence_date: date) -> tuple[str, int, int]:
    if kind == "SAAR":
        return "Current", 0, 0
    due = add_year(evidence_date)
    if due < AS_OF:
        return "Overdue", (AS_OF - due).days, 0
    days = (due - AS_OF).days
    if days <= 30:
        return "Due Within 30 Days", 0, days
    return "Current", 0, 0


def artifact_descriptor(kind: str, variation: str) -> str:
    normal = {
        "DoD Cyber Cert": "DoD Cyber Cert",
        "GEN User Agreement": "GEN User Agreement",
        "GEN and PRIV Agreement": "GEN and PRIV Agreement",
        "8140 Cert Memo": "8140 Cert Memo",
        "Privileged User Training Cert": "PRIV User Training Cert",
        "DTA Training Cert": "DTA Training Cert",
        "DTA Agreement": "DTA User Agreement",
    }[kind]
    if variation == "Reordered Keywords":
        return {
            "DoD Cyber Cert": "Final Cert DoD Cyber",
            "GEN User Agreement": "User GEN Agreement",
            "GEN and PRIV Agreement": "Agreement GEN PRIV",
            "8140 Cert Memo": "Memo Certification 8140",
            "Privileged User Training Cert": "Training PRIV User Cert",
            "DTA Training Cert": "Training DTA Cert",
            "DTA Agreement": "Agreement DTA User",
        }[kind]
    if variation == "Extra Benign Tokens":
        return f"FY26 FINAL {normal} SIGNED COPY"
    if variation == "Lowercase Keywords":
        return normal.lower()
    return normal


def identity_prefix(last: str, first: str, organization: str, style: str) -> str:
    if style == "Underscores":
        return f"{last}_{first}_({organization})"
    if style == "Comma And Spaces":
        return f"{last}, {first} ({organization})"
    if style == "Spaces":
        return f"{last} {first} ({organization})"
    if style == "Mixed Separators":
        return f"{last}_{first} ({organization})"
    if style == "Extra Spaces":
        return f"{last}   {first}   ({organization})"
    return f"{last}_{first}_({organization})"


def join_filename(prefix: str, descriptor: str, date_value: str, style: str, extension: str) -> str:
    if style == "Underscores":
        body = "_".join([prefix, descriptor.replace(" ", "_"), date_value])
    elif style == "Comma And Spaces":
        body = f"{prefix} {descriptor} {date_value}"
    elif style == "Spaces":
        body = f"{prefix}  {descriptor}  {date_value}"
    elif style == "Mixed Separators":
        body = f"{prefix}_{descriptor.replace(' ', '_')} {date_value}"
    elif style == "Extra Spaces":
        body = f"  {prefix}   {descriptor}   {date_value}  "
    else:
        body = f"{prefix}_{descriptor.replace(' ', '_')}_{date_value}"
    return f"{body}{extension}"


def evidence_filename(user: User, kind: str, evidence_date: date, filename_style: str, date_style: str, extension: str, fallback_mode: str = "") -> str:
    value = date_text(evidence_date, date_style)
    if kind == "SAAR":
        descriptor = "GEN SAAR" if user.role == "General" else f"PRIV {user.privileged_type.lower()} SAAR"
        if fallback_mode == "Placeholders":
            prefix = "Last_First_(ORG)"
            descriptor = f"{descriptor} CASE{user.index:04d}"
        elif fallback_mode == "No Identity Or Organization":
            prefix = ""
            descriptor = f"{descriptor} CASE{user.index:04d}"
        elif fallback_mode == "No Organization":
            prefix = f"{user.last}_{user.first}"
            descriptor = f"{descriptor} CASE{user.index:04d}"
        else:
            prefix = identity_prefix(user.last, user.first, user.organization, filename_style)
        return join_filename(prefix, descriptor, value, filename_style, extension).strip()
    prefix = identity_prefix(user.last, user.first, user.organization, filename_style)
    descriptor = artifact_descriptor(kind, filename_style)
    return join_filename(prefix, descriptor, value, filename_style, extension).strip()


def static_pdf_bytes(title: str, lines: list[str], marker: str = "SYNTHETIC TEST EVIDENCE") -> bytes:
    output = io.BytesIO()
    pdf = canvas.Canvas(output, pagesize=letter, pageCompression=1)
    width, height = letter
    pdf.setTitle(title)
    pdf.setFillColor(colors.HexColor("#173f35"))
    pdf.rect(0, height - 105, width, 105, fill=1, stroke=0)
    pdf.setFillColor(colors.white)
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(54, height - 58, title[:68])
    pdf.setFont("Helvetica", 9)
    pdf.drawString(54, height - 80, marker)
    y = height - 145
    pdf.setFillColor(colors.HexColor("#17231f"))
    for line in lines:
        pdf.setFont("Helvetica-Bold" if ":" not in line else "Helvetica", 11)
        pdf.drawString(54, y, line[:92])
        y -= 24
    pdf.setFillColor(colors.HexColor("#f3f7f5"))
    pdf.roundRect(54, 82, width - 108, 76, 8, stroke=0, fill=1)
    pdf.setFillColor(colors.HexColor("#405049"))
    pdf.setFont("Helvetica", 9)
    pdf.drawString(68, 132, "Synthetic test fixture only. Not valid operational, training, access, or audit evidence.")
    pdf.drawString(68, 112, "The filename and file structure intentionally exercise application validation and Sync behavior.")
    pdf.drawRightString(width - 54, 42, f"Generated {AS_OF.isoformat()} UTC")
    pdf.save()
    return output.getvalue()


def acroform_saar_bytes(user: User, email: str | None = None, include_identity: bool = True, include_organization: bool = True) -> bytes:
    output = io.BytesIO()
    pdf = canvas.Canvas(output, pagesize=letter, pageCompression=1)
    width, height = letter
    pdf.setTitle("Synthetic SAAR Test Form")
    pdf.setFillColor(colors.HexColor("#173f35"))
    pdf.rect(0, height - 105, width, 105, fill=1, stroke=0)
    pdf.setFillColor(colors.white)
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(54, height - 58, "Synthetic System Access Authorization Request")
    pdf.setFont("Helvetica", 9)
    pdf.drawString(54, height - 80, "FILLABLE ACROFORM - APPLICATION TEST DATA ONLY")
    fields = [
        ("1 NAME Last First Middle Initial", "Name", f"{user.last}, {user.first} Q" if include_identity else ""),
        ("2 ORGANIZATION", "Organization", user.organization if include_organization else ""),
        ("4 OFFICIAL EMAIL ADDRESS", "Official Email", user.email if email is None else email),
    ]
    y = height - 155
    form = pdf.acroForm
    for field_name, label, value in fields:
        pdf.setFillColor(colors.HexColor("#17231f"))
        pdf.setFont("Helvetica-Bold", 9)
        pdf.drawString(54, y, label)
        form.textfield(
            name=field_name,
            value=value,
            x=54,
            y=y - 31,
            width=width - 108,
            height=23,
            borderWidth=1,
            borderColor=colors.HexColor("#6d7f77"),
            fillColor=colors.white,
            textColor=colors.HexColor("#17231f"),
            forceBorder=True,
            fontName="Helvetica",
            fontSize=10,
        )
        y -= 70
    pdf.setFillColor(colors.HexColor("#f3f7f5"))
    pdf.roundRect(54, 92, width - 108, 86, 8, stroke=0, fill=1)
    pdf.setFillColor(colors.HexColor("#405049"))
    pdf.setFont("Helvetica", 9)
    pdf.drawString(68, 148, "Synthetic test fixture. The field names intentionally match the supported derived SAAR form.")
    pdf.drawString(68, 128, "All values are fictional. Do not use this document for an actual account request.")
    pdf.drawString(68, 108, f"Expected role: {user.role}; Privileged type: {user.privileged_type or 'None'}")
    pdf.drawRightString(width - 54, 42, f"Generated {AS_OF.isoformat()} UTC")
    pdf.save()
    return output.getvalue()


def xfa_saar_bytes(user: User, email: str | None = None, valid_dataset: bool = True) -> bytes:
    base = static_pdf_bytes(
        "Synthetic DD2875 XFA Test Form",
        [f"Name: {user.last}, {user.first} Q", f"Organization: {user.organization}", f"Official Email: {email if email is not None else user.email}"],
        marker="SYNTHETIC XFA DATASET - APPLICATION TEST DATA ONLY",
    )
    reader = PdfReader(io.BytesIO(base))
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    if valid_dataset:
        xml = (
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
            "<xfa:datasets xmlns:xfa=\"http://www.xfa.org/schema/xfa-data/1.0/\"><xfa:data><form1>"
            f"<name1>{xml_escape(user.last)}, {xml_escape(user.first)} Q</name1>"
            f"<Organization2>{xml_escape(user.organization)}</Organization2>"
            f"<Email_Address5>{xml_escape(email if email is not None else user.email)}</Email_Address5>"
            "</form1></xfa:data></xfa:datasets>"
        ).encode("utf-8")
    else:
        xml = b"<xfa:datasets><broken>"
    stream = DecodedStreamObject()
    stream.set_data(xml)
    stream_ref = writer._add_object(stream)
    acroform = DictionaryObject({NameObject("/XFA"): ArrayObject([TextStringObject("datasets"), stream_ref])})
    writer.root_object[NameObject("/AcroForm")] = writer._add_object(acroform)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def verify_acroform_saar(data: bytes, user: User) -> None:
    reader = PdfReader(io.BytesIO(data))
    fields = reader.get_fields() or {}
    expected = {
        "1 NAME Last First Middle Initial": f"{user.last}, {user.first} Q",
        "2 ORGANIZATION": user.organization,
        "4 OFFICIAL EMAIL ADDRESS": user.email,
    }
    for name, value in expected.items():
        field = fields.get(name)
        if field is None or str(field.get("/V", "")) != value:
            raise RuntimeError(f"AcroForm field verification failed for {user.last}_{user.first}: {name}")
    widgets = [
        annotation.get_object()
        for page in reader.pages
        for annotation in (page.get("/Annots") or [])
        if annotation.get_object().get("/Subtype") == "/Widget"
    ]
    for name in expected:
        if not any(str(widget.get("/T", "")) == name and widget.get("/AP") for widget in widgets):
            raise RuntimeError(f"AcroForm appearance verification failed for {user.last}_{user.first}: {name}")


def write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def write_single_pdf_zip(path: Path, pdf_name: str, pdf_bytes: bytes, *, stored: bool = False, nested: bool = False, include_directory: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    compression = zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED
    entry = f"Evidence/{pdf_name}" if nested else pdf_name
    with zipfile.ZipFile(path, "w", compression=compression, compresslevel=None if stored else 6) as archive:
        if include_directory:
            archive.writestr("Evidence/", b"")
            entry = f"Evidence/{pdf_name}"
        archive.writestr(entry, pdf_bytes)


def reset_output() -> None:
    resolved_work = WORK_ROOT.resolve()
    resolved_output = OUTPUT_ZIP.resolve()
    if ROOT.resolve() not in resolved_work.parents or ROOT.resolve() not in resolved_output.parents:
        raise RuntimeError("Generated paths must remain inside the workspace.")
    if WORK_ROOT.exists():
        shutil.rmtree(WORK_ROOT)
    if OUTPUT_ZIP.exists():
        OUTPUT_ZIP.unlink()
    if OUTPUT_GUIDE.exists():
        OUTPUT_GUIDE.unlink()
    for path in (SCAN_ROOT, MANUAL_ROOT, DELTA_ROOT, BOUNDARY_ROOT, EXPECTED_ROOT, OUTPUT_ROOT):
        path.mkdir(parents=True, exist_ok=True)


def user_list() -> list[User]:
    users: list[User] = []
    for index in range(500):
        last = LAST_NAMES[index // len(FIRST_NAMES)]
        first = FIRST_NAMES[index % len(FIRST_NAMES)]
        organization = ORGANIZATIONS[index % len(ORGANIZATIONS)]
        role = "General" if index < 300 else "Privileged"
        privileged_type = "" if role == "General" else PRIVILEGED_TYPES[(index - 300) % len(PRIVILEGED_TYPES)]
        email = f"{safe_email_part(first)}.{safe_email_part(last)}.{safe_email_part(organization)}.{index:03d}@example.test"
        users.append(User(index, last, first, organization, role, privileged_type, email))
    return users


def requirement_profile(user: User, artifact_index: int, kind: str) -> tuple[str, date, bool]:
    if kind == "SAAR":
        old = user.index % 17 == 0
        return "Old SAAR - Still Current" if old else "Current", date(2020, 1, 15) if old else STATUS_DATES["Current"], False
    missing = False
    if user.index % 19 == 0 and artifact_index == 1:
        missing = True
    if user.index % 47 == 0 and artifact_index in {1, 2}:
        missing = True
    if user.privileged_type == "CYBER" and user.index % 2 == 0 and kind == "DoD Cyber Cert":
        missing = True
    labels = ["Current", "Due Today", "Due In 7 Days", "Due In 15 Days", "Due In 30 Days", "Overdue 7 Days", "Overdue 45 Days", "Overdue 75 Days", "Overdue 120 Days"]
    label = labels[(user.index + artifact_index) % len(labels)]
    return label, STATUS_DATES[label], missing


def add_file_row(rows: list[dict[str, object]], *, path: Path, source_name: str, normalized_name: str, disposition: str, kind: str = "", user: User | None = None, container: str = "PDF", cleanup: str = "None", reason: str = "", fallback: str = "", expected_email: str = "") -> None:
    rows.append({
        "RelativePath": path.relative_to(PACKAGE_ROOT).as_posix(),
        "SourceFilename": source_name,
        "ExpectedNormalizedFilename": normalized_name,
        "ExpectedScanDisposition": disposition,
        "ExpectedArtifact": kind,
        "ExpectedLastName": user.last if user else "",
        "ExpectedFirstName": user.first if user else "",
        "ExpectedOrganization": user.organization if user else "",
        "ExpectedRole": user.role if user else "",
        "ExpectedPrivilegedType": user.privileged_type if user else "",
        "ExpectedEmail": expected_email or (user.email if user else ""),
        "Container": container,
        "ExpectedCleanUp": cleanup,
        "FallbackMode": fallback,
        "Reason": reason,
    })


def create_valid_file(path: Path, filename: str, pdf_bytes: bytes, container: str, user_index: int, artifact_index: int) -> None:
    if container == "PDF":
        write_bytes(path / filename, pdf_bytes)
    else:
        pdf_name = filename[:-4] + ".pdf" if filename.lower().endswith(".zip") else filename + ".pdf"
        write_single_pdf_zip(
            path / filename,
            pdf_name,
            pdf_bytes,
            stored=(user_index + artifact_index) % 23 == 0,
            nested=(user_index + artifact_index) % 29 == 0,
            include_directory=(user_index + artifact_index) % 31 == 0,
        )


def make_guide(summary: dict[str, object], matrix_rows: list[dict[str, str]]) -> bytes:
    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=letter, rightMargin=0.55 * inch, leftMargin=0.55 * inch, topMargin=0.55 * inch, bottomMargin=0.55 * inch)
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="GuideTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=22, leading=25, textColor=colors.HexColor("#173f35"), alignment=TA_CENTER, spaceAfter=16))
    styles.add(ParagraphStyle(name="GuideHeading", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=13, leading=16, textColor=colors.HexColor("#173f35"), spaceBefore=8, spaceAfter=7))
    styles.add(ParagraphStyle(name="GuideBody", parent=styles["BodyText"], fontSize=9.5, leading=13, textColor=colors.HexColor("#24332d"), spaceAfter=6))
    story = [
        Paragraph("Information System User Tracker", styles["GuideTitle"]),
        Paragraph("500-User Robust Test Package", styles["GuideTitle"]),
        Paragraph(f"Generated {summary['generatedAtUtc']} | Validation date {summary['asOfDate']}", styles["GuideBody"]),
        Paragraph("Purpose", styles["GuideHeading"]),
        Paragraph("This package contains synthetic records designed to exercise the tracker from initial folder mapping through Sync review, new-user ingestion, filename normalization, evidence matching, status calculations, Clean Up, incremental Sync, and error handling. No document is valid operational evidence.", styles["GuideBody"]),
        Paragraph("Baseline Test", styles["GuideHeading"]),
        Paragraph("Create a blank information system and map only 01_DirectoryScan_Main. Mapping starts Sync automatically. Review the 500 proposed users, approve them, and continue into Clean Up. The directory contains valid PDF and single-PDF ZIP evidence, intentional missing requirements, date variations, duplicates, loose PDFs, fillable AcroForm SAARs, and DD2875-style XFA SAARs.", styles["GuideBody"]),
        Table([
            ["Users", "General", "Privileged", "Organizations", "Evidence Files"],
            [str(summary["users"]), str(summary["generalUsers"]), str(summary["privilegedUsers"]), str(summary["organizationCount"]), str(summary["mainScanFiles"])],
        ], colWidths=[0.9 * inch, 0.9 * inch, 1.0 * inch, 1.1 * inch, 1.25 * inch], style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#173f35")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTNAME", (0, 1), (-1, 1), "Helvetica"),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"), ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#a8b8b1")),
            ("BACKGROUND", (0, 1), (-1, 1), colors.HexColor("#f1f6f3")), ("FONTSIZE", (0, 0), (-1, -1), 8.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 7), ("TOPPADDING", (0, 0), (-1, -1), 7),
        ])),
        Spacer(1, 10),
        Paragraph("Recommended Sequence", styles["GuideHeading"]),
    ]
    for number, item in enumerate([
        "Map 01_DirectoryScan_Main and let automatic Sync finish. Stop Sync once to validate cancellation, then start it again.",
        "Compare proposed users and evidence with Expected_Results. Apply all valid users and evidence updates.",
        "Use Clean Up to move correction PDFs to Rework, archive superseded evidence, and compress selected loose matched PDFs.",
        "Run Sync again without changes. The incremental index should skip unchanged evidence.",
        "Copy files from 03_Second_Sync_Changes into their documented targets, then Sync and confirm only changed or new files are fully validated.",
        "Use 02_Manual_Upload_Samples for manual Add User and replacement workflows, including a SAAR with a blank email field.",
        "Map each folder under B only as an isolated boundary test. Some are intentionally expected to stop Sync.",
    ], start=1):
        story.append(Paragraph(f"{number}. {item}", styles["GuideBody"]))
    story.extend([PageBreak(), Paragraph("Coverage Matrix", styles["GuideTitle"])])
    table_data = [["Area", "Location", "Expected Result"]]
    for row in matrix_rows:
        table_data.append([Paragraph(row["Area"], styles["GuideBody"]), Paragraph(row["Location"], styles["GuideBody"]), Paragraph(row["ExpectedResult"], styles["GuideBody"])])
    table = Table(table_data, colWidths=[1.45 * inch, 2.0 * inch, 3.35 * inch], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#173f35")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#a8b8b1")), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f3f7f5")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.extend([table, PageBreak(), Paragraph("Authoritative Expected Results", styles["GuideHeading"]), Paragraph("Use Expected_User_Roster.csv for the 500-user population, Expected_Requirement_Results.csv for per-user compliance outcomes, and Expected_File_Results.csv for every generated file's intended disposition. Package_Summary.json contains independent totals. SHA256SUMS.txt detects accidental changes to a fixture.", styles["GuideBody"])])
    document.build(story)
    return output.getvalue()


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    if not rows:
        raise ValueError(f"No rows provided for {path.name}")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def create_negative_cases(file_rows: list[dict[str, object]]) -> None:
    negative = SCAN_ROOT / "_Negative_And_Tolerance_Cases"
    decoys = [
        User(9001, "Invalid", "BothRoles", "GOV", "General", "", "both.roles@example.test"),
        User(9002, "Invalid", "NoRole", "LM", "General", "", "no.role@example.test"),
        User(9003, "Invalid", "NoType", "Boeing", "Privileged", "", "no.type@example.test"),
        User(9004, "Invalid", "Scanned", "USAF", "General", "", "scanned@example.test"),
        User(9005, "Invalid", "BlankEmail", "USSF", "General", "", "blank@example.test"),
        User(9006, "Invalid", "MalformedXfa", "Navy", "General", "", "bad.xfa@example.test"),
    ]
    current = STATUS_DATES["Current"]
    cases: list[tuple[User, str, bytes, str]] = []
    cases.append((decoys[0], f"{decoys[0].last}_{decoys[0].first}_({decoys[0].organization})_GEN_PRIV_SAAR_{normalized_date(current)}.pdf", acroform_saar_bytes(decoys[0]), "Both GEN and PRIV role markers"))
    cases.append((decoys[1], f"{decoys[1].last}_{decoys[1].first}_({decoys[1].organization})_SAAR_{normalized_date(current)}.pdf", acroform_saar_bytes(decoys[1]), "Missing GEN or PRIV role marker"))
    cases.append((decoys[2], f"{decoys[2].last}_{decoys[2].first}_({decoys[2].organization})_PRIV_TYPE_SAAR_{normalized_date(current)}.pdf", acroform_saar_bytes(decoys[2]), "PRIV type placeholder was not replaced"))
    cases.append((decoys[3], f"{decoys[3].last}_{decoys[3].first}_({decoys[3].organization})_GEN_SAAR_{normalized_date(current)}.pdf", static_pdf_bytes("Flattened SAAR", ["No AcroForm or XFA fields are present."]), "Scanned or flattened SAAR is not accepted for automatic ingestion"))
    cases.append((decoys[4], f"{decoys[4].last}_{decoys[4].first}_({decoys[4].organization})_GEN_SAAR_{normalized_date(current)}.pdf", acroform_saar_bytes(decoys[4], email=""), "Official Email is blank during directory Sync"))
    cases.append((decoys[5], f"{decoys[5].last}_{decoys[5].first}_({decoys[5].organization})_GEN_SAAR_{normalized_date(current)}.pdf", xfa_saar_bytes(decoys[5], valid_dataset=False), "Malformed XFA dataset"))
    for user, filename, data, reason in cases:
        path = negative / "Rework" / filename
        write_bytes(path, data)
        add_file_row(file_rows, path=path, source_name=filename, normalized_name=filename, disposition="Rework", kind="SAAR", user=user, cleanup="Move To Rework", reason=reason)

    corrupt_name = f"Corrupt_Content_User_(GOV)_GEN_SAAR_{normalized_date(current)}.pdf"
    corrupt_path = negative / "Rejected" / corrupt_name
    write_bytes(corrupt_path, b"%PDF-1.7\nthis synthetic file intentionally has no PDF end marker\n")
    add_file_row(file_rows, path=corrupt_path, source_name=corrupt_name, normalized_name=corrupt_name, disposition="RejectedContent", reason="PDF end marker is missing")

    text_name = f"Wrong_Extension_User_(GOV)_DoD_Cyber_Cert_{normalized_date(current)}.txt"
    text_path = negative / "Rejected" / text_name
    write_bytes(text_path, static_pdf_bytes("Wrong Extension", ["Valid PDF bytes with a TXT extension."]))
    add_file_row(file_rows, path=text_path, source_name=text_name, normalized_name=text_name, disposition="RejectedContent", kind="DoD Cyber Cert", reason="Evidence-like filename uses a disallowed extension")

    valid_pdf = static_pdf_bytes("ZIP Validation Fixture", ["Synthetic content"])
    multi_name = f"Zip_Multiple_(GOV)_DoD_Cyber_Cert_{normalized_date(current)}.zip"
    multi_path = negative / "Rejected" / multi_name
    multi_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(multi_path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("one.pdf", valid_pdf)
        archive.writestr("two.pdf", valid_pdf)
    add_file_row(file_rows, path=multi_path, source_name=multi_name, normalized_name=multi_name, disposition="RejectedContent", reason="ZIP contains two PDFs")

    traversal_name = f"Zip_Traversal_(GOV)_GEN_User_Agreement_{normalized_date(current)}.zip"
    traversal_path = negative / "Rejected" / traversal_name
    with zipfile.ZipFile(traversal_path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("../unsafe.pdf", valid_pdf)
    add_file_row(file_rows, path=traversal_path, source_name=traversal_name, normalized_name=traversal_name, disposition="RejectedContent", reason="ZIP contains an unsafe traversal path")

    non_pdf_name = f"Zip_Text_(GOV)_GEN_User_Agreement_{normalized_date(current)}.zip"
    non_pdf_path = negative / "Rejected" / non_pdf_name
    with zipfile.ZipFile(non_pdf_path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("readme.txt", b"not a PDF")
    add_file_row(file_rows, path=non_pdf_path, source_name=non_pdf_name, normalized_name=non_pdf_name, disposition="RejectedContent", reason="ZIP contains a non-PDF file")

    too_many_name = f"Zip_Entries_(GOV)_GEN_User_Agreement_{normalized_date(current)}.zip"
    too_many_path = negative / "Rejected" / too_many_name
    with zipfile.ZipFile(too_many_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for index in range(9):
            archive.writestr(f"d{index}/", b"")
    add_file_row(file_rows, path=too_many_path, source_name=too_many_name, normalized_name=too_many_name, disposition="RejectedContent", reason="ZIP exceeds the eight-entry safety limit")

    ratio_name = f"Zip_Ratio_(GOV)_DoD_Cyber_Cert_{normalized_date(current)}.zip"
    ratio_path = negative / "Rejected" / ratio_name
    high_ratio = b"%PDF-1.7\n" + (b"0" * (2 * 1024 * 1024)) + b"\n%%EOF\n"
    with zipfile.ZipFile(ratio_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        archive.writestr("ratio.pdf", high_ratio)
    add_file_row(file_rows, path=ratio_path, source_name=ratio_name, normalized_name=ratio_name, disposition="RejectedContent", reason="ZIP expansion ratio exceeds the safety limit")

    ignored_cases = [
        (f"Ignored_Date_User_(GOV)_DoD_Cyber_Cert_31FEB2026.pdf", "Impossible calendar date"),
        (f"Ignored_Keyword_User_(GOV)_Cyber_Cert_{normalized_date(current)}.pdf", "Cyber without DoD must not count as DoD Cyber Cert"),
        (f"Ignored_Agreement_Person_(GOV)_GEN_Agreement_{normalized_date(current)}.pdf", "GEN Agreement without USER is not sufficient"),
        (f"Ignored_NoDate_User_(GOV)_GEN_User_Agreement.pdf", "No recognized date"),
        (f"notes_{normalized_date(current)}.pdf", "No supported artifact markers"),
    ]
    for filename, reason in ignored_cases:
        path = negative / "Ignored" / filename
        write_bytes(path, static_pdf_bytes("Ignored Filename Fixture", [reason]))
        add_file_row(file_rows, path=path, source_name=filename, normalized_name=filename, disposition="IgnoredFilename", reason=reason)

    unmatched_name = f"Unknown_Person_(GOV)_DoD_Cyber_Cert_{normalized_date(current)}.pdf"
    unmatched_path = negative / "Unmatched" / unmatched_name
    write_bytes(unmatched_path, static_pdf_bytes("Unmatched Evidence", ["Valid evidence filename for a user who has no SAAR or directory record."]))
    add_file_row(file_rows, path=unmatched_path, source_name=unmatched_name, normalized_name=unmatched_name, disposition="Unmatched", kind="DoD Cyber Cert", reason="No matching Last_First user record")

    reversed_name = f"Vivian_Shaw_(LM)_GEN_User_Agreement_{normalized_date(current)}.pdf"
    reversed_path = negative / "Unmatched" / reversed_name
    write_bytes(reversed_path, static_pdf_bytes("Reversed Name Evidence", ["The intended person would be Shaw, Vivian; this filename must not match that identity."]))
    add_file_row(file_rows, path=reversed_path, source_name=reversed_name, normalized_name=reversed_name, disposition="Unmatched", kind="GEN User Agreement", reason="First_Last is rejected as a match for Last_First")


def create_boundary_cases(file_rows: list[dict[str, object]]) -> None:
    current = STATUS_DATES["Current"]
    depth_root = BOUNDARY_ROOT / "D26"
    path = depth_root
    for _ in range(27):
        path = path / "d"
    filename = f"Depth_Test_(GOV)_DoD_Cyber_Cert_{normalized_date(current)}.pdf"
    deep_file = path / filename
    write_bytes(deep_file, static_pdf_bytes("Depth Limit Fixture", ["This file intentionally exceeds the folder nesting limit."]))
    add_file_row(file_rows, path=deep_file, source_name=filename, normalized_name=filename, disposition="ExpectedSyncStop", kind="DoD Cyber Cert", reason="Folder nesting exceeds 25 levels")

    long_root = BOUNDARY_ROOT / "L181"
    padding = "A" * 138
    source = f"Long_Path_(GOV)_DoD_Cyber_Cert_{padding}_20260826.pdf"
    normalized = source.replace("20260826", "26AUG2026")
    long_file = long_root / source
    write_bytes(long_file, static_pdf_bytes("Long Filename Fixture", ["The alternate date requires a rename whose safe target is intentionally too long."]))
    add_file_row(file_rows, path=long_file, source_name=source, normalized_name=normalized, disposition="ExpectedSyncStop", kind="DoD Cyber Cert", reason="Normalized evidence filename exceeds the 180-character safety limit")

    collision_root = BOUNDARY_ROOT / "COLLISION"
    first = User(9101, "Collision", "Casey", "GOV", "General", "", "casey.collision.gov@example.test")
    second = User(9102, "Collision", "Casey", "LM", "General", "", "casey.collision.lm@example.test")
    for user in (first, second):
        filename = evidence_filename(user, "SAAR", current, "Underscores", "DDMMMYYYY", ".pdf")
        target = collision_root / user.organization / filename
        write_bytes(target, acroform_saar_bytes(user))
        add_file_row(file_rows, path=target, source_name=filename, normalized_name=filename, disposition="IdentityCollisionReview", kind="SAAR", user=user, reason="The tracker identity key is Last_First and intentionally does not create two simultaneous records with the same name")


def create_manual_samples(users: list[User], file_rows: list[dict[str, object]]) -> None:
    selected = [users[0]]
    for privileged_type in PRIVILEGED_TYPES:
        selected.append(next(user for user in users if user.privileged_type == privileged_type))
    current = STATUS_DATES["Current"]
    for user in selected:
        folder = MANUAL_ROOT / f"{user.last}_{user.first}_{user.privileged_type or 'GEN'}"
        for artifact_index, kind in enumerate(required_artifacts(user)):
            filename = evidence_filename(user, kind, current, "Underscores", "DDMMMYYYY", ".pdf")
            data = acroform_saar_bytes(user) if kind == "SAAR" else static_pdf_bytes(f"Synthetic {kind}", [f"Name: {user.last}, {user.first}", f"Organization: {user.organization}", f"Role: {user.role}"])
            target = folder / filename
            write_bytes(target, data)
            add_file_row(file_rows, path=target, source_name=filename, normalized_name=filename, disposition="ManualUploadSample", kind=kind, user=user, container="PDF", cleanup="Compress When Stored")
    blank = User(9200, "Manual", "EmailEntry", "GOV", "General", "", "operator.enters.this@example.test")
    filename = evidence_filename(blank, "SAAR", current, "Underscores", "DDMMMYYYY", ".pdf")
    target = MANUAL_ROOT / "Blank_Email_Field" / filename
    write_bytes(target, acroform_saar_bytes(blank, email=""))
    add_file_row(file_rows, path=target, source_name=filename, normalized_name=filename, disposition="ManualEmailEntryAllowed", kind="SAAR", user=blank, expected_email="", reason="Manual Add User may supply Official Email when the supported SAAR field is blank")


def create_second_sync_changes(users: list[User], file_rows: list[dict[str, object]]) -> None:
    current = AS_OF - timedelta(days=10)
    for user in users[:40]:
        kind = "DoD Cyber Cert" if user.index % 2 == 0 else "GEN User Agreement"
        filename = evidence_filename(user, kind, current, "Underscores", "YYYYMMDD", ".pdf")
        target_subdir = f"COPY_TO_01_DirectoryScan_Main/{user.organization}/{user.last}_{user.first}"
        target = DELTA_ROOT / target_subdir / filename
        data = static_pdf_bytes(f"Second Sync {kind}", [f"Name: {user.last}, {user.first}", "Expected: new current evidence supersedes the older selected artifact."])
        write_bytes(target, data)
        add_file_row(file_rows, path=target, source_name=filename, normalized_name=filename.replace(date_text(current, "YYYYMMDD"), normalized_date(current)), disposition="SecondSyncNewOrChanged", kind=kind, user=user, cleanup="Archive Superseded After Approval", reason="Copy into the documented user folder after the baseline Sync")

    overwrite_user = users[40]
    overwrite_date = STATUS_DATES["Current"]
    overwrite_name = evidence_filename(overwrite_user, "GEN User Agreement", overwrite_date, "Underscores", "DDMMMYYYY", ".pdf")
    overwrite_target = DELTA_ROOT / "OVERWRITE_EXISTING_SAME_NAME" / overwrite_user.organization / f"{overwrite_user.last}_{overwrite_user.first}" / overwrite_name
    write_bytes(overwrite_target, static_pdf_bytes("Changed Bytes Same Filename", ["Replace the same-named baseline PDF to verify the Sync index detects changed size or timestamp.", f"Marker: {datetime.now(timezone.utc).isoformat()}"]))
    add_file_row(file_rows, path=overwrite_target, source_name=overwrite_name, normalized_name=overwrite_name, disposition="SecondSyncOverwrite", kind="GEN User Agreement", user=overwrite_user, reason="Overwrite the same-named baseline file to test incremental index invalidation")


def main() -> None:
    reset_output()
    users = user_list()
    user_rows: list[dict[str, object]] = []
    requirement_rows: list[dict[str, object]] = []
    file_rows: list[dict[str, object]] = []
    date_style_counts: Counter[str] = Counter()
    filename_style_counts: Counter[str] = Counter()
    fallback_counts: Counter[str] = Counter()

    for user in users:
        filename_style = FILENAME_STYLES[user.index % len(FILENAME_STYLES)]
        artifacts = required_artifacts(user)
        fallback_mode = ""
        if user.index % 53 == 0:
            fallback_mode = "Placeholders"
        elif user.index % 71 == 0:
            fallback_mode = "No Identity Or Organization"
        elif user.index % 89 == 0:
            fallback_mode = "No Organization"
        saar_format = "XFA" if user.index % 20 == 0 else "AcroForm"
        profile_tags: set[str] = set()
        selected_statuses: list[str] = []
        user_folder = SCAN_ROOT / user.organization / f"{user.last}_{user.first}"

        for artifact_index, kind in enumerate(artifacts):
            label, evidence_date, missing = requirement_profile(user, artifact_index, kind)
            expected, days_overdue, days_until_due = expected_status(kind, evidence_date)
            date_style = DATE_STYLES[(user.index + artifact_index) % len(DATE_STYLES)]
            style = FILENAME_STYLES[(user.index + artifact_index) % len(FILENAME_STYLES)]
            if kind == "SAAR":
                style = filename_style
                if fallback_mode:
                    date_style = "DDMMMYYYY"
            if missing:
                requirement_rows.append({
                    "LastName": user.last, "FirstName": user.first, "Organization": user.organization, "Role": user.role,
                    "PrivilegedUserType": user.privileged_type, "Artifact": kind, "ExpectedStatus": "Missing",
                    "ExpectedDaysOverdue": 0, "ExpectedDaysUntilDue": 0, "SelectedFilenameAfterSync": "", "Profile": "Intentionally Missing",
                })
                selected_statuses.append("Missing")
                profile_tags.add("Missing")
                if user.privileged_type == "CYBER" and kind == "DoD Cyber Cert":
                    false_name = join_filename(identity_prefix(user.last, user.first, user.organization, "Underscores"), "Cyber Cert", normalized_date(evidence_date), "Underscores", ".pdf")
                    false_path = user_folder / false_name
                    write_bytes(false_path, static_pdf_bytes("Cyber False Positive Guard", ["The filename has CYBER but intentionally omits DoD.", "It must not satisfy DoD Cyber Cert."]))
                    add_file_row(file_rows, path=false_path, source_name=false_name, normalized_name=false_name, disposition="IgnoredFilename", user=user, reason="CYBER privileged type or keyword alone must not satisfy DoD Cyber Cert")
                continue

            container = "PDF" if (user.index * 3 + artifact_index) % 13 == 0 else "ZIP"
            extension = ".pdf" if container == "PDF" else ".zip"
            filename = evidence_filename(user, kind, evidence_date, style, date_style, extension, fallback_mode if kind == "SAAR" else "")
            normalized_name = filename.replace(date_text(evidence_date, date_style), normalized_date(evidence_date))
            nested_folder = user_folder
            if user.index in {97, 293, 499} and artifact_index == len(artifacts) - 1:
                nested_folder = SCAN_ROOT / "D"
                for _ in range(20):
                    nested_folder = nested_folder / "d"
                profile_tags.add("Depth 21 Accepted")
            if user.index == 498 and kind == "GEN User Agreement":
                padding = "FINAL_REVIEWED_" * 5
                stem, suffix = filename.rsplit(".", 1)
                filename = f"{stem}_{padding[:65]}.{suffix}"
                normalized_name = filename.replace(date_text(evidence_date, date_style), normalized_date(evidence_date))
                profile_tags.add("Near Filename Limit")

            if kind == "SAAR":
                pdf_bytes = xfa_saar_bytes(user) if saar_format == "XFA" else acroform_saar_bytes(user)
                if saar_format == "AcroForm" and user.index % 67 == 0:
                    verify_acroform_saar(pdf_bytes, user)
                fallback_counts[fallback_mode or "Filename Primary"] += 1
                profile_tags.add(saar_format)
            else:
                pdf_bytes = static_pdf_bytes(
                    f"Synthetic {kind}",
                    [f"Name: {user.last}, {user.first}", f"Organization: {user.organization}", f"Role: {user.role}", f"Evidence Date: {evidence_date.isoformat()}", f"Expected Status: {expected}"],
                )
            create_valid_file(nested_folder, filename, pdf_bytes, container, user.index, artifact_index)
            target = nested_folder / filename
            cleanup = "Compress Matched Loose PDF" if container == "PDF" else "None"
            add_file_row(file_rows, path=target, source_name=filename, normalized_name=normalized_name, disposition="AcceptedEvidence", kind=kind, user=user, container=container, cleanup=cleanup, fallback=fallback_mode if kind == "SAAR" else "")
            selected_name = normalized_name + (".zip" if cleanup == "Compress Matched Loose PDF" else "")
            requirement_rows.append({
                "LastName": user.last, "FirstName": user.first, "Organization": user.organization, "Role": user.role,
                "PrivilegedUserType": user.privileged_type, "Artifact": kind, "ExpectedStatus": expected,
                "ExpectedDaysOverdue": days_overdue, "ExpectedDaysUntilDue": days_until_due,
                "SelectedFilenameAfterSync": selected_name, "Profile": label,
            })
            selected_statuses.append(expected)
            profile_tags.add(expected)
            date_style_counts[date_style] += 1
            filename_style_counts[style] += 1

            if user.index % 12 == 0 and kind != "SAAR" and artifact_index == 1:
                old_date = evidence_date_for(-400)
                old_style = DATE_STYLES[(user.index + 5) % len(DATE_STYLES)]
                old_filename = evidence_filename(user, kind, old_date, "Mixed Separators", old_style, ".zip")
                old_normalized = old_filename.replace(date_text(old_date, old_style), normalized_date(old_date))
                old_pdf = static_pdf_bytes(f"Superseded {kind}", [f"Name: {user.last}, {user.first}", "Expected: duplicate or superseded evidence for Archive Review."])
                write_single_pdf_zip(user_folder / old_filename, old_filename[:-4] + ".pdf", old_pdf)
                add_file_row(file_rows, path=user_folder / old_filename, source_name=old_filename, normalized_name=old_normalized, disposition="AcceptedSuperseded", kind=kind, user=user, container="ZIP", cleanup="Archive Review", reason="A newer valid file for this user and artifact is also present")
                profile_tags.add("Duplicate")

            if user.index % 37 == 0 and kind != "SAAR" and artifact_index == 2:
                two_date_name = filename.replace(date_text(evidence_date, date_style), f"01JAN2020_{date_text(evidence_date, date_style)}")
                two_date_normalized = two_date_name.replace(date_text(evidence_date, date_style), normalized_date(evidence_date))
                two_date_path = user_folder / two_date_name
                if container == "PDF":
                    write_bytes(two_date_path, pdf_bytes)
                else:
                    write_single_pdf_zip(two_date_path, two_date_name[:-4] + ".pdf", pdf_bytes)
                add_file_row(file_rows, path=two_date_path, source_name=two_date_name, normalized_name=two_date_normalized, disposition="AcceptedSuperseded", kind=kind, user=user, container=container, cleanup="Archive Review", reason="Two dates are present; the rightmost recognized date controls and duplicate review remains operator-controlled")
                profile_tags.add("Two Dates")

        overall = "Missing" if "Missing" in selected_statuses else "Overdue" if "Overdue" in selected_statuses else "Due Within 30 Days" if "Due Within 30 Days" in selected_statuses else "Current"
        user_rows.append({
            "UserNumber": user.index + 1, "LastName": user.last, "FirstName": user.first,
            "Organization": user.organization, "Role": user.role, "PrivilegedUserType": user.privileged_type,
            "OfficialEmail": user.email, "ExpectedOverallStatus": overall, "SAARFormat": saar_format,
            "SAARFallback": fallback_mode or "Filename Primary", "CoverageTags": "; ".join(sorted(profile_tags)),
        })

    create_negative_cases(file_rows)
    create_manual_samples(users, file_rows)
    create_second_sync_changes(users, file_rows)
    create_boundary_cases(file_rows)

    matrix_rows = [
        {"Area": "500-User Ingest", "Location": "01_DirectoryScan_Main", "ExpectedResult": "Exactly 500 valid new users; 300 General and 200 Privileged across 15 organizations."},
        {"Area": "Privileged Types", "Location": "Main scan and roster", "ExpectedResult": "DADM, ADM, PADM, CYBER, DTA, DEV, CDA, and CCL are prepopulated; DTA users require DTA evidence."},
        {"Area": "Filename Tolerance", "Location": "Main scan", "ExpectedResult": "Underscores, comma-space, spaces, mixed separators, extra spaces, keyword case, reordered keywords, and benign tokens pass when required tokens remain present."},
        {"Area": "Date Normalization", "Location": "Main scan", "ExpectedResult": "Eleven supported date layouts are converted atomically to DDMMMYYYY before matching."},
        {"Area": "Status Boundaries", "Location": "Requirement manifest", "ExpectedResult": "Current, due today, due in 7/15/30 days, and overdue 7/45/75/120 days are represented; SAAR never becomes overdue."},
        {"Area": "Form Fallback", "Location": "Main scan SAARs", "ExpectedResult": "AcroForm and XFA fields provide Official Email and recover missing or placeholder name/organization values."},
        {"Area": "DoD False Positive", "Location": "CYBER users", "ExpectedResult": "CYBER without a DoD token does not satisfy DoD Cyber Cert and the requirement remains Missing."},
        {"Area": "ZIP Validation", "Location": "Main scan and negative cases", "ExpectedResult": "Single-PDF ZIPs pass; traversal, multiple files, non-PDF content, excessive entries, and excessive expansion fail safely."},
        {"Area": "Clean Up", "Location": "Main scan", "ExpectedResult": "Loose matched PDFs are offered for verified compression; superseded evidence is offered for Archive Review; correction PDFs are offered for Rework."},
        {"Area": "Incremental Sync", "Location": "03_Second_Sync_Changes", "ExpectedResult": "An unchanged rescan skips cached files; new, overwritten, or moved evidence is fully revalidated."},
        {"Area": "Manual Upload", "Location": "02_Manual_Upload_Samples", "ExpectedResult": "Representative General and all Privileged types can be uploaded; the blank-email SAAR allows operator email entry only in manual Add User."},
        {"Area": "Depth And Length", "Location": "B/D26 and B/L181", "ExpectedResult": "Depth 26 and unsafe normalization length stop Sync without replacing the database; a near-limit valid main filename passes."},
        {"Area": "Identity Collision", "Location": "B/COLLISION", "ExpectedResult": "Same Last_First in different organizations is isolated for manual review of the current identity-key behavior."},
    ]

    summary = {
        "generatedAtUtc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "asOfDate": AS_OF.isoformat(),
        "users": len(user_rows),
        "generalUsers": sum(row["Role"] == "General" for row in user_rows),
        "privilegedUsers": sum(row["Role"] == "Privileged" for row in user_rows),
        "organizationCount": len(set(row["Organization"] for row in user_rows)),
        "organizations": dict(sorted(Counter(str(row["Organization"]) for row in user_rows).items())),
        "privilegedTypes": dict(sorted(Counter(str(row["PrivilegedUserType"]) for row in user_rows if row["PrivilegedUserType"]).items())),
        "requirements": len(requirement_rows),
        "requirementStatuses": dict(sorted(Counter(str(row["ExpectedStatus"]) for row in requirement_rows).items())),
        "mainScanFiles": sum(str(row["RelativePath"]).startswith("01_DirectoryScan_Main/") for row in file_rows),
        "allGeneratedTestFiles": len(file_rows),
        "scanDispositions": dict(sorted(Counter(str(row["ExpectedScanDisposition"]) for row in file_rows).items())),
        "dateStyles": dict(sorted(date_style_counts.items())),
        "filenameStyles": dict(sorted(filename_style_counts.items())),
        "saarFallbackModes": dict(sorted(fallback_counts.items())),
    }

    write_csv(EXPECTED_ROOT / "Expected_User_Roster.csv", user_rows)
    write_csv(EXPECTED_ROOT / "Expected_Requirement_Results.csv", requirement_rows)
    write_csv(EXPECTED_ROOT / "Expected_File_Results.csv", file_rows)
    write_csv(EXPECTED_ROOT / "Test_Coverage_Matrix.csv", matrix_rows)
    (EXPECTED_ROOT / "Expected_File_Results.json").write_text(json.dumps(file_rows, indent=2) + "\n", encoding="utf-8")
    (EXPECTED_ROOT / "Package_Summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    readme = f"""INFORMATION SYSTEM USER TRACKER - 500-USER ROBUST TEST PACKAGE

This package contains synthetic data only. It was generated on {summary['generatedAtUtc']} for a validation date of {AS_OF.isoformat()}.

QUICK START
1. Extract the package to a short local path such as C:\\ISUT-Test.
2. Start with a clean application build and add one blank information system.
3. Map only 01_DirectoryScan_Main. Mapping launches Sync automatically.
4. Review and approve the 500 valid users. Compare results with Expected_Results.
5. Continue into Clean Up to test Rework, Archive Review, and verified PDF compression.
6. Run Sync again without changing files. Unchanged files should be skipped.
7. Follow 03_Second_Sync_Changes to test new and changed file detection.
8. Map each B child folder only as an isolated boundary test.

EXPECTED POPULATION
- 500 users: 300 General and 200 Privileged.
- 15 organizations.
- Eight Privileged User Types: _dadm, _adm, _padm, _cyber, _dta, _dev, _cda, and _ccl.
- DTA is represented as a Privileged User Type, not a separate User Role.

IMPORTANT
- Do not map the package root. Map only the folder named by the test step.
- Invalid and scan-stopping boundary cases are isolated so they cannot invalidate the main 500-user run.
- Dates are expected relative to {AS_OF.isoformat()}; regenerate the package for a future inspection window.
- SAARs are never overdue. A valid SAAR is Current regardless of its filename date.
- CYBER in a privileged SAAR or filename does not satisfy DoD Cyber Cert without a DoD token.
- All identities use Last Name followed by First Name. Reversed names intentionally do not match.
- Every document is fictional and must never be used as real access, training, or audit evidence.

See Test_Package_Guide.pdf and Expected_Results for the complete sequence and authoritative outcomes.
"""
    (PACKAGE_ROOT / "README.txt").write_text(readme, encoding="utf-8")
    guide_bytes = make_guide(summary, matrix_rows)
    (PACKAGE_ROOT / "Test_Package_Guide.pdf").write_bytes(guide_bytes)
    OUTPUT_GUIDE.write_bytes(guide_bytes)

    checksum_lines: list[str] = []
    for path in sorted(PACKAGE_ROOT.rglob("*")):
        if path.is_file() and path.name != "SHA256SUMS.txt":
            checksum_lines.append(f"{hashlib.sha256(path.read_bytes()).hexdigest().upper()}  {path.relative_to(PACKAGE_ROOT).as_posix()}")
    (PACKAGE_ROOT / "SHA256SUMS.txt").write_text("\n".join(checksum_lines) + "\n", encoding="utf-8")

    with zipfile.ZipFile(OUTPUT_ZIP, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
        for path in sorted(PACKAGE_ROOT.rglob("*")):
            if path.is_file():
                archive.write(path, (Path(ARCHIVE_ROOT_NAME) / path.relative_to(PACKAGE_ROOT)).as_posix())

    summary["output"] = str(OUTPUT_ZIP)
    summary["outputBytes"] = OUTPUT_ZIP.stat().st_size
    summary["outputSha256"] = hashlib.sha256(OUTPUT_ZIP.read_bytes()).hexdigest().upper()
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
