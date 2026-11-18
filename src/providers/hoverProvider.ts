import * as vscode from 'vscode';
import { profileNameFromAgentId } from '../core/agentReference';
import { getProfileSchemaProperty, getWorkflowSchemaProperty } from '../core/profileSchema';
import { parseWorkflow } from '../core/workflowModel';
import { parseProfileInfo, yamlFieldAt } from '../core/yamlModel';
import type { DirectorIndexService } from '../indexService';
import { resolveDirectorLocation } from '../location';

export class DirectorHoverProvider implements vscode.HoverProvider {
  constructor(private readonly indexes: DirectorIndexService) {}

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    const location = resolveDirectorLocation(document);
    if (!location) return undefined;
    if (location.kind === 'profile') {
      return profileSchemaHover(document, position, location.root);
    }
    const schemaHover = workflowSchemaHover(document, position, location.root);
    if (schemaHover) return schemaHover;
    const model = parseWorkflow(document.getText());
    if (model.errors.length) return undefined;
    const offset = document.offsetAt(position);
    const reference = model.steps.flatMap((step) => step.agents)
      .find((agent) => agent.start <= offset && offset <= agent.end);
    if (!reference) return undefined;
    const name = profileNameFromAgentId(reference.value);
    const profile = name && this.indexes.get(location.root).profiles.get(name);
    if (!profile) return undefined;
    const profileDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(profile.filePath));
    const info = parseProfileInfo(profileDoc.getText());
    if (!info) return undefined;
    const markdown = new vscode.MarkdownString();
    markdown.appendMarkdown('**Profile: ').appendText(profile.name).appendMarkdown('**\n\n');
    if (info.description) markdown.appendText(info.description).appendMarkdown('\n\n');
    if (info.phase) markdown.appendMarkdown('**phase:** ').appendText(info.phase).appendMarkdown('\n\n');
    if (info.tools.length) markdown.appendMarkdown('**tools:** ').appendText(info.tools.join(', '));
    return new vscode.Hover(markdown, new vscode.Range(document.positionAt(reference.start), document.positionAt(reference.end)));
  }
}

function workflowSchemaHover(
  document: vscode.TextDocument,
  position: vscode.Position,
  root: string,
): vscode.Hover | undefined {
  const field = yamlFieldAt(document.getText(), document.offsetAt(position));
  if (!field) return undefined;
  const description = getWorkflowSchemaProperty(root, field.path)?.description;
  if (!description) return undefined;
  return createSchemaHover(document, field.key, description, field.start, field.end);
}

function profileSchemaHover(
  document: vscode.TextDocument,
  position: vscode.Position,
  root: string,
): vscode.Hover | undefined {
  const field = yamlFieldAt(document.getText(), document.offsetAt(position));
  if (!field) return undefined;
  const description = getProfileSchemaProperty(root, field.path)?.description;
  if (!description) return undefined;
  return createSchemaHover(document, field.key, description, field.start, field.end);
}

function createSchemaHover(
  document: vscode.TextDocument,
  key: string,
  description: string,
  start: number,
  end: number,
): vscode.Hover {
  const markdown = new vscode.MarkdownString();
  markdown.appendMarkdown(`**${key}**\n\n`).appendText(description);
  return new vscode.Hover(
    markdown,
    new vscode.Range(document.positionAt(start), document.positionAt(end)),
  );
}
