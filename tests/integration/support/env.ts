import { randomBytes } from "node:crypto";

// Runs before each integration test file: point the app at the test database and use
// deterministic auth settings. Breach checks are off so tests never call an external API.
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL must be set for integration tests");
process.env.DATABASE_URL = url;
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64"); // fresh per run
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.AUTH_RATE_LIMIT_ENABLED = "false";
process.env.AUTH_PASSWORD_BREACH_CHECK = "false";
