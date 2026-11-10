using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;

internal sealed class OperatorProfile
{
    private readonly string windowsUser;
    private string fullName;

    public OperatorProfile(string windowsUser, bool loadStoredProfile)
    {
        this.windowsUser = windowsUser ?? "";
        fullName = loadStoredProfile ? Load(this.windowsUser) : "";
    }

    public string Actor { get { return String.IsNullOrWhiteSpace(fullName) ? windowsUser : fullName + " (" + windowsUser + ")"; } }

    public string SessionUserJson()
    {
        return Serializer().Serialize(new Dictionary<string, object> { { "user", windowsUser }, { "fullName", fullName }, { "actor", Actor }, { "profileRequired", String.IsNullOrWhiteSpace(fullName) } });
    }

    public string Save(byte[] requestBody)
    {
        if (requestBody == null || requestBody.Length == 0 || requestBody.Length > 4096) throw new InvalidDataException("The operator profile request is empty or too large.");
        JavaScriptSerializer serializer = Serializer();Dictionary<string, object> request;
        try { request = serializer.DeserializeObject(Encoding.UTF8.GetString(requestBody)) as Dictionary<string, object>; }
        catch (Exception error) { throw new InvalidDataException("The operator profile request is not valid JSON.", error); }
        string next = Normalize(request != null && request.ContainsKey("fullName") ? Convert.ToString(request["fullName"]) : "");
        if (next.Length < 2 || next.Length > 100 || !next.Any(Char.IsLetter)) throw new InvalidDataException("Enter a valid full name containing letters and no more than 100 characters.");
        string directory = ProfileDirectory(), path = Path.Combine(directory, "operator-profile.json"), temporary = path + ".tmp";Directory.CreateDirectory(directory);
        string text = serializer.Serialize(new Dictionary<string, object> { { "version", 1 }, { "windowsUser", windowsUser }, { "fullName", next }, { "updatedAtUtc", DateTime.UtcNow.ToString("o") } });
        File.WriteAllText(temporary, text, new UTF8Encoding(false));
        try { if (File.Exists(path)) File.Replace(temporary, path, null);else File.Move(temporary, path); }
        finally { try { if (File.Exists(temporary)) File.Delete(temporary); } catch { } }
        fullName = next;return SessionUserJson();
    }

    private static string Load(string windowsUser)
    {
        try
        {
            string path = Path.Combine(ProfileDirectory(), "operator-profile.json");if (!File.Exists(path)) return "";
            JavaScriptSerializer serializer = Serializer();Dictionary<string, object> profile = serializer.DeserializeObject(File.ReadAllText(path, Encoding.UTF8)) as Dictionary<string, object>;
            if (profile == null || !profile.ContainsKey("version") || Convert.ToInt32(profile["version"]) != 1 || !profile.ContainsKey("windowsUser") || !String.Equals(Convert.ToString(profile["windowsUser"]), windowsUser, StringComparison.OrdinalIgnoreCase)) return "";
            string candidate = Normalize(profile.ContainsKey("fullName") ? Convert.ToString(profile["fullName"]) : "");return candidate.Length >= 2 && candidate.Length <= 100 && candidate.Any(Char.IsLetter) ? candidate : "";
        }
        catch { return ""; }
    }

    private static JavaScriptSerializer Serializer() { return new JavaScriptSerializer { MaxJsonLength = 4096, RecursionLimit = 4 }; }
    private static string ProfileDirectory() { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RAPTOR", "System"); }
    private static string Normalize(string value) { return String.IsNullOrWhiteSpace(value) ? "" : String.Join(" ", value.Where(character => !Char.IsControl(character)).Aggregate(new StringBuilder(), (builder, character) => builder.Append(Char.IsWhiteSpace(character) ? ' ' : character)).ToString().Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries)); }
}
