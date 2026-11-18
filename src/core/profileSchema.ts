import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ProfileSchemaProperty {
  description?: string;
  enum?: unknown[];
  items?: ProfileSchemaProperty;
  properties?: Record<string, ProfileSchemaProperty>;
  $ref?: string;
}

interface JsonSchema {
  properties?: Record<string, ProfileSchemaProperty>;
  $defs?: Record<string, ProfileSchemaProperty>;
}

interface CachedSchema {
  modified: number;
  size: number;
  schema: JsonSchema | undefined;
}

const schemaCache = new Map<string, CachedSchema>();

export function getProfileSchemaProperty(
  root: string,
  keyPath: string[],
): ProfileSchemaProperty | undefined {
  return getSchemaProperty(root, 'subagent-profile.schema.json', keyPath);
}

export function getWorkflowSchemaProperty(
  root: string,
  keyPath: string[],
): ProfileSchemaProperty | undefined {
  return getSchemaProperty(root, 'workflow.schema.json', keyPath);
}

function getSchemaProperty(
  root: string,
  fileName: string,
  keyPath: string[],
): ProfileSchemaProperty | undefined {
  const schemaPath = path.join(root, '.director', 'workflows', 'schema', fileName);
  const schema = loadSchema(schemaPath);
  if (!schema) return undefined;

  let current: ProfileSchemaProperty | undefined = schema;
  for (const [index, key] of keyPath.entries()) {
    current = resolveReference(schema, current);
    if (!current?.properties) {
      if (!current?.items) return undefined;
      current = resolveReference(schema, current.items);
    }
    current = current?.properties?.[key];
    if (!current) return undefined;
    if (index === keyPath.length - 1) {
      const resolved = resolveReference(schema, current);
      return { ...resolved, ...current };
    }
  }
  return undefined;
}

function loadSchema(schemaPath: string): JsonSchema | undefined {
  try {
    const stat = fs.statSync(schemaPath);
    const cached = schemaCache.get(schemaPath);
    if (cached?.modified === stat.mtimeMs && cached.size === stat.size) {
      return cached.schema;
    }

    const parsed: unknown = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const schema = isJsonSchema(parsed) ? parsed : undefined;
    if (!schema) {
      console.warn(`DirectoR: スキーマの形式が不正です: ${schemaPath}`);
    }
    schemaCache.set(schemaPath, { modified: stat.mtimeMs, size: stat.size, schema });
    return schema;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      console.warn(`DirectoR: profile スキーマを読み込めませんでした: ${schemaPath}`);
    }
    schemaCache.delete(schemaPath);
    return undefined;
  }
}

export function getProfileSchemaEnum(root: string, key: string): string[] {
  const property = getProfileSchemaProperty(root, [key]);
  const values = property?.items && Array.isArray(property.items.enum)
    ? property.items.enum
    : property?.enum;
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === 'string'))];
}

function resolveReference(
  root: JsonSchema,
  schema: ProfileSchemaProperty | undefined,
): ProfileSchemaProperty | undefined {
  if (!schema?.$ref?.startsWith('#/')) return schema;
  let current: unknown = root;
  for (const part of schema.$ref.slice(2).split('/')) {
    if (!isRecord(current)) return undefined;
    current = current[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return isProfileSchemaProperty(current) ? current : undefined;
}

function isJsonSchema(value: unknown): value is JsonSchema {
  if (!isRecord(value)) return false;
  if (value.properties === undefined) return true;
  if (!isRecord(value.properties)) return false;
  return Object.values(value.properties).every(isProfileSchemaProperty);
}

function isProfileSchemaProperty(value: unknown): value is ProfileSchemaProperty {
  if (!isRecord(value)) return false;
  if (value.description !== undefined && typeof value.description !== 'string') return false;
  if (value.enum !== undefined && !Array.isArray(value.enum)) return false;
  if (value.items !== undefined && !isProfileSchemaProperty(value.items)) return false;
  if (value.properties !== undefined) {
    if (!isRecord(value.properties)) return false;
    if (!Object.values(value.properties).every(isProfileSchemaProperty)) return false;
  }
  if (value.$ref !== undefined && typeof value.$ref !== 'string') return false;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
