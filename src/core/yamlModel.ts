import { isMap, isScalar, isSeq, parseDocument } from 'yaml';

export interface LocatedString {
  value: string;
  start: number;
  end: number;
}

export function parseYaml(text: string) {
  return parseDocument(text, { prettyErrors: false });
}

export function field(node: unknown, key: string): unknown {
  return isMap(node) ? node.get(key, true) : undefined;
}

export function entries(node: unknown): unknown[] {
  return isSeq(node) ? node.items : [];
}

export function stringAt(node: unknown, text: string): LocatedString | undefined {
  if (!isScalar(node) || typeof node.value !== 'string' || !node.range) {
    return undefined;
  }
  let [start, end] = node.range;
  const raw = text.slice(start, end);
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    start += 1;
    end -= 1;
  }
  return { value: node.value, start, end };
}

export function stringValue(node: unknown): string | undefined {
  return isScalar(node) && typeof node.value === 'string' ? node.value : undefined;
}

export function numberValue(node: unknown): number | undefined {
  return isScalar(node) && typeof node.value === 'number' ? node.value : undefined;
}

export interface LocatedYamlField {
  key: string;
  path: string[];
  start: number;
  end: number;
}

export function yamlFieldAt(text: string, offset: number): LocatedYamlField | undefined {
  const doc = parseYaml(text);
  if (doc.errors.length) return undefined;
  return findYamlField(doc.contents, offset, []);
}

function findYamlField(
  node: unknown,
  offset: number,
  path: string[],
): LocatedYamlField | undefined {
  if (isMap(node)) {
    for (const pair of node.items) {
      const key = stringValue(pair.key);
      const range = isScalar(pair.key) ? pair.key.range : undefined;
      if (!key || !range) continue;
      if (range[0] <= offset && offset <= range[1]) {
        return { key, path: [...path, key], start: range[0], end: range[1] };
      }
      const value = findYamlField(pair.value, offset, [...path, key]);
      if (value) return value;
    }
    return undefined;
  }
  if (isSeq(node)) {
    for (const item of node.items) {
      const value = findYamlField(item, offset, path);
      if (value) return value;
    }
  }
  return undefined;
}

export interface ProfileInfo {
  description?: string;
  phase?: string;
  template?: LocatedString;
  tools: string[];
  artifacts: LocatedString[];
}

export function parseProfileInfo(text: string): ProfileInfo | undefined {
  const doc = parseYaml(text);
  if (doc.errors.length || !isMap(doc.contents)) {
    return undefined;
  }
  const artifactMap = field(doc.contents, 'artifacts');
  const aliases = new Map<string, string>();
  const artifacts: LocatedString[] = [];
  if (isMap(artifactMap)) {
    for (const pair of artifactMap.items) {
      const alias = stringValue(pair.key);
      const target = stringAt(pair.value, text);
      if (alias && target) {
        aliases.set(alias, target.value);
        artifacts.push(target);
      }
    }
  }
  for (const section of entries(field(doc.contents, 'artifact_sections'))) {
    const reference = stringAt(field(section, 'artifact'), text);
    const target = reference && aliases.get(reference.value);
    if (reference && target) {
      artifacts.push({ ...reference, value: target });
    }
  }
  return {
    description: stringValue(field(doc.contents, 'description')),
    phase: stringValue(field(doc.contents, 'phase')),
    template: stringAt(field(doc.contents, 'template'), text),
    tools: entries(field(doc.contents, 'tools')).map(stringValue).filter((value): value is string => value !== undefined),
    artifacts,
  };
}
