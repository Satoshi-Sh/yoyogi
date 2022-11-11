import { Entity, MegalodonInterface } from "megalodon";
import { useEffect, useState } from "react";
import { Thread } from "./Thread";
import styles from "../styles/ShowAuthor.module.css";

export type Trees = {
  // Set to hold the toots starting threads (even of length 1), also indexed by ID (number)
  progenitorIds: Set<string>;
  // ids of statuses by the author below which are only non-author statuses
  foldedIds: Map<string, boolean>;
  // Map between ID (number) and its corresponding status object
  id2status: Map<string, Entity.Status>;
  // Maps to hold the directed graph of toots: indexed by ID (number) only
  child2parentid: Map<string, string>;
  parent2childid: Map<string, Set<string>>;
  // For counting and display
  id2numDescendants: Map<string, { all: number; shown: number }>;
  maxContiguousId?: string;
  minContiguousId?: string;
};

function initializeTrees(): Trees {
  return {
    progenitorIds: new Set(),
    foldedIds: new Map(),
    id2status: new Map(),
    child2parentid: new Map(),
    parent2childid: new Map(),
    id2numDescendants: new Map(),
  };
}

async function newest(
  megalodon: MegalodonInterface,
  account: Entity.Account
): Promise<Trees> {
  const trees = initializeTrees();
  const res = await megalodon.getAccountStatuses(account.id, { limit: 5 });
  await addStatusesToTreesImpure(trees, res.data, megalodon, account.id);
  return trees;
}
async function oldest(
  megalodon: MegalodonInterface,
  account: Entity.Account
): Promise<Trees> {
  const trees = initializeTrees();
  const res = await megalodon.getAccountStatuses(account.id, {
    min_id: "0",
    limit: 5,
  });
  await addStatusesToTreesImpure(trees, res.data, megalodon, account.id);
  return trees;
}
async function newer(
  megalodon: MegalodonInterface,
  account: Entity.Account,
  trees: Trees,
  numNewThreads: number
): Promise<Trees> {
  const initialNumThreads = trees.progenitorIds.size;
  while (trees.progenitorIds.size < initialNumThreads + numNewThreads) {
    const res = await megalodon.getAccountStatuses(account.id, {
      min_id: trees.maxContiguousId,
    });
    if (res.data.length === 0) {
      break;
    }
    await addStatusesToTreesImpure(trees, res.data, megalodon, account.id);
  }
  return { ...trees };
}
async function older(
  megalodon: MegalodonInterface,
  account: Entity.Account,
  trees: Trees,
  numNewThreads: number
): Promise<Trees> {
  const initialNumThreads = trees.progenitorIds.size;
  while (trees.progenitorIds.size < initialNumThreads + numNewThreads) {
    const res = await megalodon.getAccountStatuses(account.id, {
      max_id: trees.minContiguousId,
    });
    if (res.data.length === 0) {
      break;
    }
    await addStatusesToTreesImpure(trees, res.data, megalodon, account.id);
  }
  return { ...trees };
}

export interface ShowAuthorProps {
  megalodon: MegalodonInterface;
  account: Entity.Account;
}
export function ShowAuthor({ account, megalodon }: ShowAuthorProps) {
  const [trees, setTrees] = useState(() => initializeTrees());
  // initial populate for this account
  useEffect(() => {
    (async function () {
      const trees = await newest(megalodon, account);
      setTrees(trees);
    })();
  }, [megalodon, account]);
  // Save to global
  useEffect(() => {
    (window as any).trees = trees;
  }, [trees]);

  return (
    <div className={styles["all-threads"]}>
      <div className={styles["button-bar"]}>
        <button
          onClick={async () => {
            setTrees(await newest(megalodon, account));
          }}
        >
          Newest
        </button>
        <button
          onClick={async () => {
            setTrees(await newer(megalodon, account, trees, 1));
          }}
        >
          Newer
        </button>
      </div>
      {Array.from(trees.progenitorIds)
        .sort((a, b) => b.localeCompare(a))
        .map((id) => (
          <Thread
            key={id + "/0"}
            trees={trees}
            progenitorId={id}
            authorId={account.id}
            depth={1}
            sectionNumbers={[1]}
          />
        ))}
      <div className={styles["button-bar"]}>
        <button
          onClick={async () => {
            setTrees(await older(megalodon, account, trees, 1));
          }}
        >
          Older
        </button>
        <button
          onClick={async () => {
            setTrees(await oldest(megalodon, account));
          }}
        >
          Oldest
        </button>
      </div>
    </div>
  );
}

function minmaxStrings(v: string[]): [string | undefined, string | undefined] {
  if (v.length === 0) {
    return [undefined, undefined];
  }
  const iter = v.values();
  let min: string = iter.next().value;
  let max = min;
  for (const x of iter) {
    min = x.localeCompare(min) < 0 ? x : min;
    max = x.localeCompare(max) > 0 ? x : max;
  }
  return [min, max];
}

async function addStatusesToTreesImpure(
  trees: Trees,
  statuses: Entity.Status[],
  megalodon: MegalodonInterface,
  authorId: string
): Promise<void> {
  {
    const ids = statuses.map((s) => s.id);
    if (trees.maxContiguousId !== undefined) {
      ids.concat(trees.maxContiguousId);
    }
    if (trees.minContiguousId !== undefined) {
      ids.concat(trees.minContiguousId);
    }
    const [min, max] = minmaxStrings(ids);
    trees.maxContiguousId = max;
    trees.minContiguousId = min;
  }

  // serialize this to reduce Chrome making a ton of HTTP requests
  // Otherwise we could use Promise.all…
  for (const s of statuses) {
    if (trees.id2status.has(s.id)) {
      continue;
    }

    // these `getStatusContext`s should really be in try/catch

    // find the progenitor, get all its descendants
    let progenitor: Entity.Status;
    if (s.in_reply_to_id) {
      const req = await megalodon.getStatusContext(s.id, { max_id: s.id });
      progenitor = req.data.ancestors[0];
      if (!progenitor) {
        // this might happen if the server hasn't yet fetched a copy of the parent?
        progenitor = s;
      }
    } else {
      progenitor = s;
    }
    trees.progenitorIds.add(progenitor.id);

    const data = (await megalodon.getStatusContext(progenitor.id)).data;
    const descendants = data.descendants;
    // will this have a limit? Do we have to recurse with `max_id`?

    trees.id2status.set(progenitor.id, progenitor);
    for (const d of descendants) {
      trees.id2status.set(d.id, d);
      const parentOfD = d.in_reply_to_id;
      if (!parentOfD) {
        // won't happen since this is not a progenitor
        continue;
      }
      // link child to parent and vice versa
      const hit = trees.parent2childid.get(parentOfD) || new Set();
      hit.add(d.id);
      trees.parent2childid.set(parentOfD, hit);
      if (trees.parent2childid.get(d.id)?.has(d.id)) {
        debugger;
      }
      trees.child2parentid.set(d.id, parentOfD);
    }

    // handle descendant counting and folding
    traverseFromTop(progenitor.id, trees, authorId);
  }
}
function sum(v: number[]) {
  return v.length === 0 ? 0 : v.reduce((p, c) => p + c, 0);
}
/**
 * Count each status's # of descendants, and whether it's "folded".
 * A status is "folded" if it and all its descendants are not by the author.
 */
function traverseFromTop(
  id: string,
  trees: Trees,
  authorId: string
): { all: number; shown: number; authorFound: boolean } {
  const children = trees.parent2childid.get(id);
  if (!children) {
    const all = 0;
    const shown = 0;
    const authorFound = trees.id2status.get(id)?.account.id === authorId;

    trees.id2numDescendants.set(id, { all, shown });
    trees.foldedIds.set(id, !authorFound);

    return { all, shown, authorFound };
  }
  const recur = Array.from(children, (id) =>
    traverseFromTop(id, trees, authorId)
  );
  const sumAll = sum(recur.map((o) => o.all));
  const sumShown = sum(recur.map((o) => o.shown));
  // combine descendants with this status
  const authorFound =
    recur.some((o) => o.authorFound) ||
    trees.id2status.get(id)?.account.id === authorId;
  const all = children.size + sumAll;
  const shown =
    sum(Array.from(children, (id) => +!trees.foldedIds.get(id))) + sumShown;

  trees.id2numDescendants.set(id, { all, shown });
  trees.foldedIds.set(id, !authorFound);

  return { all, shown, authorFound };
}

export function getGuaranteed<K, V>(m: Map<K, V>, key: K): V {
  const ret = m.get(key);
  if (ret === undefined) {
    throw new Error("safeGet was unsafe");
  }
  return ret;
}
