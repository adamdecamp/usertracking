# Sanitized SAAR compatibility corpus

This directory contains synthetic field packets only. It must never contain real names, email addresses, signatures, account data, or operational forms.

Each compatibility case represents a supported DD Form 2875 or derived-SAAR field layout. Regression tests generate an in-memory PDF from each packet and verify identity, organization, Official Email, and Designation of Person extraction. Add a sanitized case whenever a legitimate form variant is encountered in production.
