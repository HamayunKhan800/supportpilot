/**
 * Loads secrets from AWS Systems Manager Parameter Store into the environment at cold start
 * (plan M8 revision 2, R6), so secrets never sit in the Lambda function's configuration, in
 * Terraform state or in the image.
 *
 * SSM_PARAMETER_PATHS lists one or more parameter folders, e.g.
 *   /supportpilot/production/shared/,/supportpilot/production/web/
 * Each parameter directly inside a folder becomes one variable named after its last path
 * part: /supportpilot/production/web/BETTER_AUTH_SECRET -> BETTER_AUTH_SECRET.
 *
 * Rules (fail fast, and never put a value in an error or log line):
 *  - a name must look like an environment variable (A-Z, 0-9, _);
 *  - a variable may come from one place only: not from two folders, and not from both a
 *    folder and the function's own settings, so there is never a question which one wins.
 */
import { GetParametersByPathCommand, SSMClient } from "@aws-sdk/client-ssm";

export interface Parameter {
  /** Full parameter name, e.g. /supportpilot/production/web/BETTER_AUTH_SECRET. */
  name: string;
  value: string;
}

/** Reads every parameter directly inside one folder (decrypted). */
export type ParameterReader = (path: string) => Promise<Parameter[]>;

const ENV_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;
const FOLDER = /^\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*\/$/;

export class SsmEnvError extends Error {
  override name = "SsmEnvError";
}

/** Parses SSM_PARAMETER_PATHS: comma-separated folders, each normalised to end in "/". */
export function parseParameterPaths(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const paths = value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.endsWith("/") ? p : `${p}/`));
  for (const p of paths) {
    if (!FOLDER.test(p)) throw new SsmEnvError(`SSM_PARAMETER_PATHS entry is not a folder path: ${p}`);
  }
  if (new Set(paths).size !== paths.length) throw new SsmEnvError("SSM_PARAMETER_PATHS lists a folder twice");
  return paths;
}

/**
 * Reads the folders and copies their parameters into `env`. Returns the variable names it
 * set (names only, for the startup log).
 */
export async function loadParametersIntoEnv(
  paths: string[],
  read: ParameterReader,
  env: NodeJS.ProcessEnv,
): Promise<string[]> {
  const found = new Map<string, string>();
  for (const folder of paths) {
    for (const parameter of await read(folder)) {
      const key = parameter.name.slice(folder.length);
      if (!parameter.name.startsWith(folder) || !ENV_NAME.test(key)) {
        throw new SsmEnvError(`Parameter ${parameter.name} is not named like an environment variable`);
      }
      if (found.has(key)) throw new SsmEnvError(`${key} is stored in more than one SSM folder`);
      if (env[key] !== undefined) {
        throw new SsmEnvError(`${key} is set both in the function settings and in SSM; keep one`);
      }
      found.set(key, parameter.value);
    }
  }
  for (const [key, value] of found) env[key] = value;
  return [...found.keys()].sort();
}

/** The real reader: GetParametersByPath, decrypted, one folder level, every page. */
export function ssmParameterReader(client: SSMClient = new SSMClient({})): ParameterReader {
  return async (path) => {
    const parameters: Parameter[] = [];
    let nextToken: string | undefined;
    do {
      const page = await client.send(
        new GetParametersByPathCommand({
          Path: path,
          Recursive: false,
          WithDecryption: true,
          MaxResults: 10,
          NextToken: nextToken,
        }),
      );
      for (const p of page.Parameters ?? []) {
        if (p.Name && p.Value !== undefined) parameters.push({ name: p.Name, value: p.Value });
      }
      nextToken = page.NextToken;
    } while (nextToken);
    return parameters;
  };
}
