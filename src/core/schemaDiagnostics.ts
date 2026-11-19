import { isMap, isNode, isScalar, isSeq, type Node } from 'yaml';

import type { JsonSchema, ProfileSchemaProperty } from './profileSchema';
import { parseYaml } from './yamlModel';

export interface SchemaDiagnostic {
  start: number;
  end: number;
  message: string;
}

export function validateSchema(
  text: string,
  schema: JsonSchema | undefined,
): SchemaDiagnostic[] {
  if (!schema) return [];
  const document = parseYaml(text);
  if (document.errors.length || !document.contents) return [];
  const diagnostics: SchemaDiagnostic[] = [];
  validateNode(document.contents, schema, schema, diagnostics);
  return diagnostics;
}

function validateNode(
  node: Node,
  schema: ProfileSchemaProperty,
  root: JsonSchema,
  diagnostics: SchemaDiagnostic[],
): void {
  const resolved = resolveReference(schema, root);
  if (!resolved) return;
  const current = { ...resolved, ...schema };

  for (const branch of current.allOf ?? []) {
    validateNode(node, branch, root, diagnostics);
  }
  for (const branches of [[current.anyOf, 'anyOf'], [current.oneOf, 'oneOf']] as const) {
    const [schemas, keyword] = branches;
    if (!schemas) continue;
    const matches = schemas.filter((branch) => schemaMatches(node, branch, root));
    if ((keyword === 'anyOf' && matches.length === 0) || (keyword === 'oneOf' && matches.length !== 1)) {
      addDiagnostic(node, `${keyword} の条件に一致する分岐がありません。`, diagnostics);
    }
  }
  if (current.if) {
    const branch = schemaMatches(node, current.if, root) ? current.then : current.else;
    if (branch) validateNode(node, branch, root, diagnostics);
  }
  if (current.not && schemaMatches(node, current.not, root)) {
    addDiagnostic(node, '組み合わせは許可されていません。', diagnostics);
  }

  const expectedTypes = Array.isArray(current.type)
    ? current.type
    : current.type
      ? [current.type]
      : [];
  if (expectedTypes.length && !expectedTypes.some((type) => matchesType(node, type))) {
    addDiagnostic(node, `型が不正です。${expectedTypes.join(' または ')} を指定してください。`, diagnostics);
    return;
  }

  if (isScalar(node)) {
    if (current.const !== undefined && !Object.is(node.value, current.const)) {
      addDiagnostic(node, `値は ${String(current.const)} にしてください。`, diagnostics);
    }
    if (current.enum && !current.enum.some((value) => Object.is(value, node.value))) {
      addDiagnostic(node, `候補外の値です。指定可能: ${current.enum.join(', ')}`, diagnostics);
    }
    if (typeof node.value === 'string') {
      if (typeof current.minLength === 'number' && node.value.length < current.minLength) {
        addDiagnostic(node, `${current.minLength}文字以上を指定してください。`, diagnostics);
      }
      if (current.pattern && !new RegExp(current.pattern).test(node.value)) {
        addDiagnostic(node, `形式が不正です（${current.pattern}）。`, diagnostics);
      }
    }
    if (typeof node.value === 'number' && typeof current.minimum === 'number' &&
        node.value < current.minimum) {
      addDiagnostic(node, `${current.minimum}以上を指定してください。`, diagnostics);
    }
  }

  function schemaMatches(node: Node, schema: ProfileSchemaProperty, root: JsonSchema): boolean {
    const diagnostics: SchemaDiagnostic[] = [];
    validateNode(node, schema, root, diagnostics);
    return diagnostics.length === 0;
  }

  if (isSeq(node)) {
    if (typeof current.minItems === 'number' && node.items.length < current.minItems) {
      addDiagnostic(node, `${current.minItems}件以上を指定してください。`, diagnostics);
    }
    if (typeof current.maxItems === 'number' && node.items.length > current.maxItems) {
      addDiagnostic(node, `${current.maxItems}件以下を指定してください。`, diagnostics);
    }
    if (current.uniqueItems) {
      const values = new Set<string>();
      for (const item of node.items) {
        if (!isNode(item)) continue;
        const value = JSON.stringify(item.toJSON());
        if (values.has(value)) {
          addDiagnostic(item, '配列内で値が重複しています。', diagnostics);
        }
        values.add(value);
      }
    }
    if (current.items) {
      for (const item of node.items) {
        if (isNode(item)) validateNode(item, current.items, root, diagnostics);
      }
    }
  }

  if (!isMap(node)) return;
  const allowed = current.properties ?? {};
  const present = new Set<string>();
  for (const pair of node.items) {
    const key = isScalar(pair.key) && typeof pair.key.value === 'string' ? pair.key.value : undefined;
    if (!key) continue;
    present.add(key);
    const property = allowed[key];
    if (property) {
      if (isNode(pair.value)) validateNode(pair.value, property, root, diagnostics);
    } else if (current.additionalProperties === false) {
      addDiagnostic(pair.key, `スキーマにないキーです: ${key}`, diagnostics);
    } else if (typeof current.additionalProperties === 'object' && isNode(pair.value)) {
      validateNode(pair.value, current.additionalProperties, root, diagnostics);
    }
  }
  for (const key of current.required ?? []) {
    if (!present.has(key)) {
      addDiagnostic(node, `必須キーがありません: ${key}`, diagnostics);
    }
  }
}

function resolveReference(
  schema: ProfileSchemaProperty,
  root: JsonSchema,
): ProfileSchemaProperty | undefined {
  if (!schema.$ref?.startsWith('#/')) return schema;
  let current: unknown = root;
  for (const part of schema.$ref.slice(2).split('/')) {
    if (!isRecord(current)) return undefined;
    current = current[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return isRecord(current) ? current as ProfileSchemaProperty : undefined;
}

function matchesType(node: Node, type: string): boolean {
  switch (type) {
    case 'object': return isMap(node);
    case 'array': return isSeq(node);
    case 'string': return isScalar(node) && typeof node.value === 'string';
    case 'integer': return isScalar(node) && typeof node.value === 'number' && Number.isInteger(node.value);
    case 'number': return isScalar(node) && typeof node.value === 'number';
    case 'boolean': return isScalar(node) && typeof node.value === 'boolean';
    case 'null': return isScalar(node) && node.value === null;
    default: return true;
  }
}

function addDiagnostic(node: unknown, message: string, diagnostics: SchemaDiagnostic[]): void {
  const range = isNode(node) ? node.range : undefined;
  diagnostics.push({
    start: range?.[0] ?? 0,
    end: Math.max(range?.[1] ?? 0, (range?.[0] ?? 0) + 1),
    message: `Schema: ${message}`,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
