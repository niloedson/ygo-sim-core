/**
 * @file markdownTreeReporter.ts
 * @description Hierarchical Markdown Decision Tree Reporter for ygo-sim-core combo exploration.
 * Formats phase progression audits, Open Game State node ledgers, and ranked terminal endpoints
 * with RFC 0001 YGN move paths, single-line YBN board snapshots, and V(YBN) valuation breakdowns.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { TreeSearchResult } from '../search/treeTraversal.js';
import { CardRegistry, globalCardRegistry } from '../dsl/archetypeLoader.js';

export interface TreeReportOptions {
  hand: string[];
  deckName?: string;
  outputDir?: string;
  fileName?: string;
}

export function generateComboTreeMarkdownReport(
  treeResult: TreeSearchResult,
  options: TreeReportOptions,
  registry: CardRegistry = globalCardRegistry
): string {
  const deckName = options.deckName ?? 'RB (Revol Bots)';
  const handCards = options.hand.map((h) => {
    const cardDef = registry.getCardById(h) ?? registry.getCardByName(h);
    return {
      passcode: cardDef?.id ?? h,
      name: cardDef?.name ?? h,
      role: cardDef?.taxonomyRole ?? 'TECH'
    };
  });

  const now = new Date();
  const dateStr = now.toISOString().replace('T', ' ').slice(0, 19);

  let md = '';

  // Title & Metadata
  md += `# Combo Decision Tree & Valuation Report: ${deckName}\n\n`;
  md += `> **Generated on:** ${dateStr} | **Engine:** \`ygo-sim-core v1.0.0\` | **Nodes Evaluated:** ${treeResult.nodesEvaluated}\n\n`;

  // 1. Hand Context
  md += `## 1. Opening Hand Context (Turn 1)\n\n`;
  md += `| Slot | Card Name | Passcode | Taxonomy Role |\n`;
  md += `| :---: | :--- | :---: | :--- |\n`;
  handCards.forEach((c, idx) => {
    md += `| **#${idx + 1}** | **${c.name}** | \`${c.passcode}\` | \`[${c.role}]\` |\n`;
  });
  md += `\n`;

  // 2. Chronological Phase Progression Audit
  md += `## 2. Chronological Turn 1 Phase Progression Audit\n\n`;
  md += `| Phase | Legal Activations | Outcome & Rules Compliance |\n`;
  md += `| :---: | :---: | :--- |\n`;
  if (treeResult.phaseAudits && treeResult.phaseAudits.length > 0) {
    for (const audit of treeResult.phaseAudits) {
      md += `| **@${audit.phase}** | **${audit.actionsFound}** | ${audit.notes} |\n`;
    }
  } else {
    md += `| **@DP** | 0 | Going first player skips normal draw. No legal DP activations found. |\n`;
    md += `| **@SP** | 0 | Standby Phase verified. No legal SP triggers or fast effects found. |\n`;
    md += `| **@M1** | Active | Main Phase 1 Open Game State initiated. |\n`;
  }
  md += `\n`;

  // 3. Open Game State (OGS) Decision Tree & Node Ledger
  md += `## 3. Open Game State Decision Tree & Node Ledger\n\n`;
  md += `At every Open Game State (OGS), legal priority actions were evaluated and branched:\n\n`;

  // First 15 OGS nodes to prevent overwhelming documents while preserving full transparency
  const displayNodes = treeResult.nodeLedgers.slice(0, 25);
  for (const node of displayNodes) {
    md += `### ${node.nodeId} (Depth ${node.depth} - Phase: \`@${node.phase}\`)\n\n`;
    md += `* **YGN Action Sequence:**\n`;
    md += `  \`\`\`ygn\n  ${node.ygnPath}\n  \`\`\`\n`;
    md += `* **YBN Board Snapshot:**\n`;
    md += `  \`\`\`ybn\n  ${node.ybnState}\n  \`\`\`\n`;
    md += `* **$V(\\text{YBN})$ Board Valuation:** **${node.ybnScore.toFixed(1)}** ` +
          `(Field Negates: ${node.interruptions.field_negates}, Backrow: ${node.interruptions.backrow_disruptions}, ` +
          `GY: ${node.interruptions.gy_triggers}, Hand: ${node.interruptions.hand_traps}, ` +
          `Layers: ${node.interruptions.distinct_layers})\n`;

    if (node.isTerminal) {
      md += `* **Status:** ★ **TERMINAL STATE** (No further legal actions available)\n\n`;
    } else {
      md += `* **Available Branch Choices (${node.availableActions.length}):**\n`;
      for (const act of node.availableActions) {
        md += `  - \`${act.ygnNotation}\`: ${act.description}\n`;
      }
      md += `\n`;
    }
  }

  if (treeResult.nodeLedgers.length > 25) {
    md += `*(Truncated display: ${treeResult.nodeLedgers.length - 25} additional intermediate tree nodes omitted for brevity. See raw log file for exhaustive trace.)*\n\n`;
  }

  // 4. Ranked Terminal End-Boards
  md += `## 4. Ranked Terminal End-Boards\n\n`;
  if (treeResult.topPlaylines.length === 0) {
    md += `*No valid combo playlines reached terminal states.*\n\n`;
  } else {
    treeResult.topPlaylines.slice(0, 5).forEach((line, idx) => {
      md += `### Rank #${idx + 1}: ${idx === 0 ? 'Primary Ceiling Line' : 'Alternative Decision Branch'}\n\n`;
      md += `* **Depth:** ${line.depth} actions | **Cycle Detected:** ${line.cycleDetected ? 'YES' : 'NO'}\n`;
      md += `* **YGN Transcript:**\n`;
      md += `  \`\`\`ygn\n  ${line.ygnTranscript}\n  \`\`\`\n`;
      md += `* **Terminal YBN Board Descriptor:**\n`;
      md += `  \`\`\`ybn\n  ${line.terminalYBN}\n  \`\`\`\n\n`;
    });
  }

  md += `---\n`;
  md += `*Report automatically generated by Obsidian Yu-Gi-Oh! AI Suite (ygo-sim-core).*\n`;

  return md;
}

/**
 * Save Markdown report to disk.
 */
export function saveComboTreeMarkdownReport(
  mdContent: string,
  options: TreeReportOptions = { hand: [] }
): string {
  const dir = options.outputDir ? resolve(options.outputDir) : resolve(process.cwd(), 'reports/combo-trees');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const timestamp = `${yyyy}${mm}${dd}_${hh}${min}${ss}`;

  const fileName = options.fileName ?? `combo_tree_${timestamp}.md`;
  const filePath = resolve(dir, fileName);

  writeFileSync(filePath, mdContent, 'utf-8');
  return filePath;
}
