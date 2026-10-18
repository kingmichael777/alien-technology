// Configuration values for the backend functions.
//
// Each value is read from the function's environment first. When it is not
// set there, it is read from Supabase Vault through the app_secret() database
// function, which only the service role can call. Values found in Vault are
// kept for the life of the worker; a miss is asked again next time.

const cache = new Map<string, string>();

export async function config(name: string): Promise<string | undefined> {
  const fromEnv = Deno.env.get(name);
  if (fromEnv) return fromEnv;
  const cached = cache.get(name);
  if (cached) return cached;

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return undefined;

  try {
    const res = await fetch(`${url}/rest/v1/rpc/app_secret`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ _name: name }),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return undefined;
    }
    const data = await res.json();
    if (typeof data === "string" && data.length > 0) {
      cache.set(name, data);
      return data;
    }
  } catch {
    // Treated as missing; the caller explains what is not set up.
  }
  return undefined;
}
