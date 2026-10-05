import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
export type Json = Record<string, any>;
export class ApiError extends Error {
  status: number; code: string; retryable: boolean; details: Json;
  constructor(status: number, code: string, retryable = false, details: Json = {}) {
    super(code); this.status = status; this.code = code; this.retryable = retryable; this.details = details;
  }
}
export function reject(status: number, code: string, details: Json = {}): never { throw new ApiError(status, code, false, details); }
export function hash(value: string | Buffer) { return createHash('sha256').update(value).digest('hex'); }
export function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const contract = JSON.parse(readFileSync(new URL('../docs/technical/openapi.json', import.meta.url), 'utf8'));
const validator = new Ajv2020({ strict: false, allErrors: true });
(addFormats as unknown as (instance: Ajv2020) => void)(validator);
validator.addSchema({ $id: 'seefood', components: contract.components });
export function validate(name: string, body: unknown): asserts body is Json {
  const check = validator.getSchema(`seefood#/components/schemas/${name}`)!;
  if (!check(body)) reject(400, 'INPUT_UNSUPPORTED');
}
