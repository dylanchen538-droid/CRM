declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    ALIBABA_VAULT_KEY?: string;
    BUCKET?: R2Bucket;
  }
}
