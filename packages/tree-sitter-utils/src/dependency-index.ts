import { RankedDefinition, Tag } from './types';

type Relation = {
  definers: Set<string>;
  sources: Map<string, number>;
};

export class DependencyIndex {
  private definitions: Tag[] = [];
  private relations: Relation[] = [];
  private outbound = new Map<string, number>();

  constructor(tags: Tag[]) {
    const definitions = new Map<string, Set<string>>();
    const references = new Map<string, Map<string, number>>();
    for (const tag of tags) {
      if (tag.kind === 'def') {
        this.definitions.push(tag);
        let files = definitions.get(tag.name);
        if (!files) definitions.set(tag.name, (files = new Set()));
        files.add(tag.rel_fname);
        this.outbound.set(tag.rel_fname, 0);
      } else {
        let counts = references.get(tag.name);
        if (!counts) references.set(tag.name, (counts = new Map()));
        counts.set(tag.rel_fname, (counts.get(tag.rel_fname) ?? 0) + (tag.count ?? 1));
      }
    }
    for (const [name, definers] of definitions) {
      const counts = references.get(name);
      if (!counts) continue;
      let multiplier = 1;
      if (
        (/^[a-z][a-z0-9_]*$/.test(name) && name.includes('_')) ||
        (/^[a-z][a-z0-9-]*$/.test(name) && name.includes('-')) ||
        (/^[a-z][a-zA-Z0-9]*$/.test(name) && /[A-Z]/.test(name))
      )
        multiplier *= 10;
      if (name.startsWith('_')) multiplier *= 0.1;
      if (definers.size > 5) multiplier *= 0.1;
      const sources = new Map<string, number>();
      for (const [file, count] of counts) {
        const targets = definers.size - Number(definers.has(file));
        if (!targets) continue;
        const weight = multiplier * Math.sqrt(count);
        sources.set(file, weight);
        this.outbound.set(file, (this.outbound.get(file) ?? 0) + weight * targets);
      }
      if (sources.size) this.relations.push({ definers, sources });
    }
  }

  rank(mentionedFiles = new Set<string>(), mentionedIdents = new Set<string>()): RankedDefinition[] {
    const nodes = [...this.outbound.keys()];
    const count = nodes.length;
    if (!count) return [];
    const mentionedDefinitions = new Set(this.definitions.filter((tag) => mentionedIdents.has(tag.name)).map((tag) => tag.rel_fname));
    const weights = new Map(nodes.map((node) => [node, Number(mentionedFiles.has(node)) + Number(mentionedDefinitions.has(node))]));
    const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
    const personalization = new Map(nodes.map((node) => [node, total ? weights.get(node)! / total : 1 / count]));
    let ranks = new Map(nodes.map((node) => [node, 1 / count]));
    for (let iteration = 0; iteration < 100; iteration++) {
      let dangling = 0;
      for (const node of nodes) {
        if (!this.outbound.get(node)) dangling += ranks.get(node)!;
      }
      const base = 0.85 * dangling + 0.15;
      const next = new Map(nodes.map((node) => [node, base * personalization.get(node)!]));
      for (const { definers, sources } of this.relations) {
        let incoming = 0;
        for (const [source, weight] of sources) {
          incoming += (0.85 * ranks.get(source)! * weight) / this.outbound.get(source)!;
        }
        for (const target of definers) {
          // Each identifier is a weighted complete bipartite relation, excluding self-edges.
          const self = sources.get(target);
          const contribution = incoming - (self ? (0.85 * ranks.get(target)! * self) / this.outbound.get(target)! : 0);
          next.set(target, next.get(target)! + contribution);
        }
      }
      let error = 0;
      for (const node of nodes) error += Math.abs(next.get(node)! - ranks.get(node)!);
      ranks = next;
      if (error < count * 1e-6) break;
      if (iteration === 99) throw new Error('Repository map PageRank did not converge');
    }
    return this.definitions
      .map((tag) => ({
        rel_fname: tag.rel_fname,
        name: tag.name,
        line: tag.line,
        rank: ranks.get(tag.rel_fname)! * (this.outbound.get(tag.rel_fname) ? 2 : 1),
      }))
      .sort((a, b) => b.rank - a.rank);
  }
}
