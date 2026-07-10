export type DistributionCoderLoad = {
  tasks: number;
  doubleTasks: number;
};

type DistributionPlannerCoder = {
  id: number;
  weight: number;
  tieBreaker: number;
};

export type BalancedDoubleCodingPairQuotaPlan = {
  pairQuotas: Map<string, number>;
  plannedCoderAssignments: Map<number, number>;
  plannedPairCounts: Map<string, number>;
};

export class CodingJobDistributionPlanner {
  stableHash(value: string): number {
    let hash = 0;

    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) % 4294967291;
    }

    return hash;
  }

  chooseSingleCoder<T extends DistributionPlannerCoder>(
    coders: T[],
    itemCoderLoads: Map<number, DistributionCoderLoad>,
    coderLoads: Map<number, DistributionCoderLoad>,
    seed: string,
    responseId: number,
    taskCount = 1
  ): T {
    return coders
      .map(coder => {
        const itemLoad = itemCoderLoads.get(coder.id) || {
          tasks: 0,
          doubleTasks: 0
        };
        const load = coderLoads.get(coder.id) || {
          tasks: 0,
          doubleTasks: 0
        };

        return {
          coder,
          itemRatio: (itemLoad.tasks + taskCount) / coder.weight,
          itemTasks: itemLoad.tasks,
          globalRatio: (load.tasks + taskCount) / coder.weight,
          globalTasks: load.tasks,
          tie: this.stableHash(`${seed}:single:${responseId}:${coder.id}`)
        };
      })
      .reduce((best, candidate) => {
        const comparison =
          candidate.itemRatio - best.itemRatio ||
          candidate.itemTasks - best.itemTasks ||
          candidate.globalRatio - best.globalRatio ||
          candidate.globalTasks - best.globalTasks ||
          candidate.tie - best.tie ||
          candidate.coder.tieBreaker - best.coder.tieBreaker;

        return comparison < 0 ? candidate : best;
      }).coder;
  }

  getCoderCombinations<T>(
    coders: T[],
    size: number,
    startIndex = 0,
    prefix: T[] = []
  ): T[][] {
    if (prefix.length === size) {
      return [prefix];
    }

    const combinations: T[][] = [];

    for (let i = startIndex; i < coders.length; i += 1) {
      combinations.push(
        ...this.getCoderCombinations(coders, size, i + 1, [
          ...prefix,
          coders[i]
        ])
      );
    }

    return combinations;
  }

  getPairKey(coders: Array<{ id: number }>): string {
    return coders
      .map(coder => coder.id)
      .sort((a, b) => a - b)
      .join('-');
  }

  planBalancedDoubleCodingPairQuotas<T extends DistributionPlannerCoder>(
    coders: T[],
    coderCombinations: T[][],
    doubleCodingCount: number,
    seed: string,
    itemKey: string,
    plannedCoderAssignments: ReadonlyMap<number, number>,
    plannedPairCounts: ReadonlyMap<string, number>
  ): BalancedDoubleCodingPairQuotaPlan {
    const pairQuotas = new Map<string, number>();
    if (coderCombinations.length === 0) {
      return this.completePairQuotaPlan(
        coderCombinations,
        pairQuotas,
        plannedCoderAssignments,
        plannedPairCounts
      );
    }

    const basePairQuota = Math.floor(
      doubleCodingCount / coderCombinations.length
    );
    coderCombinations.forEach(combination => {
      pairQuotas.set(this.getPairKey(combination), basePairQuota);
    });

    const remainingPairs = doubleCodingCount % coderCombinations.length;
    if (remainingPairs === 0) {
      return this.completePairQuotaPlan(
        coderCombinations,
        pairQuotas,
        plannedCoderAssignments,
        plannedPairCounts
      );
    }

    const totalRemainingCoderAssignments = remainingPairs * 2;
    const baseRemainingCoderDegree = Math.floor(
      totalRemainingCoderAssignments / coders.length
    );
    const higherDegreeCoderCount =
      totalRemainingCoderAssignments % coders.length;
    const plannedLoadRatio = (coder: T): number => (plannedCoderAssignments.get(coder.id) || 0) / coder.weight;
    const degreeOrder = [...coders].sort(
      (a, b) => plannedLoadRatio(a) - plannedLoadRatio(b) ||
        this.stableHash(`${seed}:${itemKey}:pair-plan:coder:${a.id}`) -
          this.stableHash(`${seed}:${itemKey}:pair-plan:coder:${b.id}`) ||
        a.id - b.id
    );
    const higherDegreeCoderIds = new Set(
      degreeOrder.slice(0, higherDegreeCoderCount).map(coder => coder.id)
    );
    const remainingDegrees = coders.map(coder => ({
      coder,
      degree:
        baseRemainingCoderDegree + (higherDegreeCoderIds.has(coder.id) ? 1 : 0),
      tieBreaker: this.stableHash(
        `${seed}:${itemKey}:pair-plan:node:${coder.id}`
      )
    }));
    const extraPairs = new Set<string>();

    while (remainingDegrees.some(node => node.degree > 0)) {
      remainingDegrees.sort(
        (a, b) => b.degree - a.degree ||
          a.tieBreaker - b.tieBreaker ||
          a.coder.id - b.coder.id
      );
      const node = remainingDegrees[0];
      const requiredDegree = node.degree;
      if (requiredDegree === 0) {
        break;
      }

      const candidates = remainingDegrees
        .slice(1)
        .filter(
          candidate => candidate.degree > 0 &&
            !extraPairs.has(this.getPairKey([node.coder, candidate.coder]))
        )
        .sort((a, b) => {
          const pairKeyA = this.getPairKey([node.coder, a.coder]);
          const pairKeyB = this.getPairKey([node.coder, b.coder]);

          return (
            b.degree - a.degree ||
            (plannedPairCounts.get(pairKeyA) || 0) -
              (plannedPairCounts.get(pairKeyB) || 0) ||
            this.stableHash(`${seed}:${itemKey}:pair-plan:edge:${pairKeyA}`) -
              this.stableHash(
                `${seed}:${itemKey}:pair-plan:edge:${pairKeyB}`
              ) ||
            a.coder.id - b.coder.id
          );
        });

      if (candidates.length < requiredDegree) {
        throw new Error('Could not build balanced double-coding pair quotas.');
      }

      node.degree = 0;
      candidates.slice(0, requiredDegree).forEach(candidate => {
        const pairKey = this.getPairKey([node.coder, candidate.coder]);
        extraPairs.add(pairKey);
        candidate.degree -= 1;
        pairQuotas.set(pairKey, (pairQuotas.get(pairKey) || 0) + 1);
      });
    }

    return this.completePairQuotaPlan(
      coderCombinations,
      pairQuotas,
      plannedCoderAssignments,
      plannedPairCounts
    );
  }

  chooseDoubleCodingCoders<T extends DistributionPlannerCoder>(
    coderCombinations: T[][],
    itemCoderLoads: Map<number, DistributionCoderLoad>,
    coderLoads: Map<number, DistributionCoderLoad>,
    itemPairCounts: Map<string, number>,
    pairCounts: Map<string, number>,
    seed: string,
    responseId: number,
    taskCount = 1
  ): T[] {
    return coderCombinations
      .map(combination => {
        const projectedItemRatios = combination.map(coder => {
          const load = itemCoderLoads.get(coder.id) || {
            tasks: 0,
            doubleTasks: 0
          };
          return (load.tasks + taskCount) / coder.weight;
        });
        const projectedItemDoubleRatios = combination.map(coder => {
          const load = itemCoderLoads.get(coder.id) || {
            tasks: 0,
            doubleTasks: 0
          };
          return (load.doubleTasks + taskCount) / coder.weight;
        });
        const projectedGlobalRatios = combination.map(coder => {
          const load = coderLoads.get(coder.id) || {
            tasks: 0,
            doubleTasks: 0
          };
          return (load.tasks + taskCount) / coder.weight;
        });
        const projectedGlobalDoubleRatios = combination.map(coder => {
          const load = coderLoads.get(coder.id) || {
            tasks: 0,
            doubleTasks: 0
          };
          return (load.doubleTasks + taskCount) / coder.weight;
        });
        const pairKey = this.getPairKey(combination);

        return {
          combination,
          score: {
            maxItemLoad: Math.max(...projectedItemRatios),
            itemPairCount: itemPairCounts.get(pairKey) || 0,
            maxItemDoubleLoad: Math.max(...projectedItemDoubleRatios),
            totalItemLoad: projectedItemRatios.reduce(
              (sum, value) => sum + value,
              0
            ),
            maxGlobalLoad: Math.max(...projectedGlobalRatios),
            globalPairCount: pairCounts.get(pairKey) || 0,
            maxGlobalDoubleLoad: Math.max(...projectedGlobalDoubleRatios),
            totalGlobalLoad: projectedGlobalRatios.reduce(
              (sum, value) => sum + value,
              0
            ),
            tie: this.stableHash(`${seed}:double:${responseId}:${pairKey}`)
          }
        };
      })
      .reduce((best, candidate) => {
        const comparison =
          candidate.score.maxItemLoad - best.score.maxItemLoad ||
          candidate.score.itemPairCount - best.score.itemPairCount ||
          candidate.score.maxItemDoubleLoad -
            best.score.maxItemDoubleLoad ||
          candidate.score.totalItemLoad - best.score.totalItemLoad ||
          candidate.score.maxGlobalLoad - best.score.maxGlobalLoad ||
          candidate.score.globalPairCount - best.score.globalPairCount ||
          candidate.score.maxGlobalDoubleLoad -
            best.score.maxGlobalDoubleLoad ||
          candidate.score.totalGlobalLoad - best.score.totalGlobalLoad ||
          candidate.score.tie - best.score.tie;

        return comparison < 0 ? candidate : best;
      }).combination;
  }

  private completePairQuotaPlan<T extends DistributionPlannerCoder>(
    coderCombinations: T[][],
    pairQuotas: Map<string, number>,
    plannedCoderAssignments: ReadonlyMap<number, number>,
    plannedPairCounts: ReadonlyMap<string, number>
  ): BalancedDoubleCodingPairQuotaPlan {
    const nextCoderAssignments = new Map(plannedCoderAssignments);
    const nextPairCounts = new Map(plannedPairCounts);
    const combinationsByPairKey = new Map(
      coderCombinations.map(combination => [
        this.getPairKey(combination),
        combination
      ])
    );

    pairQuotas.forEach((quota, pairKey) => {
      if (quota === 0) {
        return;
      }

      const combination = combinationsByPairKey.get(pairKey);
      if (!combination) {
        throw new Error(`Missing coder combination for pair ${pairKey}.`);
      }

      nextPairCounts.set(pairKey, (nextPairCounts.get(pairKey) || 0) + quota);
      combination.forEach(coder => {
        nextCoderAssignments.set(
          coder.id,
          (nextCoderAssignments.get(coder.id) || 0) + quota
        );
      });
    });

    return {
      pairQuotas,
      plannedCoderAssignments: nextCoderAssignments,
      plannedPairCounts: nextPairCounts
    };
  }
}
