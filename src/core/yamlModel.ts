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
