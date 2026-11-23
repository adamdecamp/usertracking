/**
 * A Sync review holds a snapshot of every user record taken when Sync ran, and
 * applying it saves that snapshot (plus the approved changes) as the database.
 * Any save made after the review was created (a manual evidence association,
 * an exception, a role change, a new user) is not in that snapshot, so applying
 * the review would silently write the older records back over it.
 *
 * Each system keeps a save generation that advances on every real database
 * write. A review records the generation it was built from and may only be
 * applied while that generation is still current.
 */
export class SaveGenerations{
 private readonly generations=new Map<string,number>();
 current(systemId:string):number{return this.generations.get(systemId)??0}
 /** Call after a database write that actually changed stored records. */
 advance(systemId:string):number{const next=this.current(systemId)+1;this.generations.set(systemId,next);return next}
}

export type GenerationStamped={baseSaveGeneration?:number};

/** True when nothing has been saved for the system since the review was built. */
export function syncReviewIsCurrent(review:GenerationStamped,currentGeneration:number):boolean{
 return review.baseSaveGeneration===currentGeneration;
}

export const staleSyncReviewTitle='Run Sync Again';
export const staleSyncReviewMessage='User records were saved after this Sync review was prepared, so applying it would overwrite those newer changes. The review was discarded without changing anything. Run Sync again to review current evidence.';
