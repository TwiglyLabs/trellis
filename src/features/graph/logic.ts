import { Trellis } from '../../api.ts';

export function getGraphData(cwd: string) {
  const t = new Trellis(cwd);
  const result = t.graph();

  return {
    project: result.project,
    plans: result.nodes.map((n) => ({
      id: n.id,
      title: n.title,
      status: n.status,
      blocked: n.blocked,
      ready: n.ready,
      depends_on: n.dependsOn,
      tags: n.tags,
      repo: n.repo,
      description: n.description,
      filePath: t.show(n.id)?.filePath ?? '',
      body: n.body,
      outputs: n.outputs,
      inputs: n.inputs,
    })),
    chunks: result.chunks,
    crossChunkEdges: result.crossChunkEdges,
  };
}
