const RULES = [
  { id: "react-hydration", severity: "error", pattern: /hydration (failed|mismatch)|react.*#418/i, title: "React hydration failure" },
  { id: "api-401", severity: "error", pattern: /(?:\/api\/\S*|http\S+)\s*(?:returned|status|-)?:?\s*401|401\s+\(?Unauthorized\)?|(?:Error:\s*)?Unauthorized\b/i, title: "API authorization failure" },
  { id: "preferences-fallback", severity: "warn", pattern: /Preferences.*(?:not implemented|unavailable)|Native auth storage.*failed.*localStorage/i, title: "Native storage fallback" },
  { id: "supabase-auth", severity: "error", pattern: /supabase.*(?:session|auth|jwt|refresh).*(?:fail|error|expired|missing)|AuthRetryableFetchError/i, title: "Supabase session failure" },
  { id: "gradle", severity: "error", pattern: /FAILURE: Build failed|Execution failed for task|Could not resolve all files/i, title: "Gradle build failure" },
  { id: "javac", severity: "error", pattern: /error:\s*(?:cannot find symbol|package .* does not exist|incompatible types|method .* cannot be applied)/i, title: "Java compilation failure" },
  { id: "adb", severity: "error", pattern: /device (?:offline|unauthorized|not found)|no devices\/emulators found|adb.*failed/i, title: "ADB failure" },
  { id: "capacitor", severity: "error", pattern: /(?:cap|capacitor).*(?:sync|copy|update).*(?:failed|error)/i, title: "Capacitor sync failure" },
  { id: "http-error", severity: "error", pattern: /(?:\bHTTP\/?\d(?:\.\d)?\s+|\bstatus\s*[:=]?\s*)(?:4\d\d|5\d\d)\b|\b(?:4\d\d|5\d\d)\s+\([^)]*\)/i, title: "HTTP request failure" },
];

function genericProblem(title = "Unclassified error", id = "unclassified-error") {
  return { id, severity: "error", title };
}

function classify(text) {
  const rule = RULES.find((candidate) => candidate.pattern.test(text));
  return rule ? { id: rule.id, severity: rule.severity, title: rule.title } : null;
}

function redactSecrets(text) {
  return String(text)
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
    .replace(/(\\?"(?:access_token|refresh_token|id_token)\\?"\s*:\s*\\?")[^"\\]*/gi, "$1[REDACTED]")
    .replace(/([?&](?:access_token|refresh_token|id_token|token)=)[^&#\s]*/gi, "$1[REDACTED]");
}

module.exports = { classify, genericProblem, redactSecrets, RULES };
