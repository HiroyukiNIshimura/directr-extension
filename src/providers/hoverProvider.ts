import * as vscode from 'vscode';
import { profileNameFromAgentId } from '../core/agentReference';
import { parseWorkflow } from '../core/workflowModel';
import { parseProfileInfo } from '../core/yamlModel';
import type { DirectorIndexService } from '../indexService';
import { resolveDirectorLocation } from '../location';

export class DirectorHoverProvider implements vscode.HoverProvider {
  constructor(private readonly indexes: DirectorIndexService) {}

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    const location = resolveDirectorLocation(document);
    if (location?.kind !== 'workflow') return undefined;
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
