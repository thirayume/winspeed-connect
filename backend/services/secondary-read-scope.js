'use strict';

// A reviewed read on a non-primary database must be visible to the effective user and,
// during Access As, to the real actor as well. On the primary database there is no
// identity mapping and these helpers change nothing.
const { getVisibleScope, scopeFilter } = require('./visible-scope');
const { actorPerspective } = require('./business-identity');
const { nativeChainInScope } = require('./native-document-scope');

/** The real actor's scope during Access As on a secondary database, otherwise null. */
async function secondaryActorScope(user) {
  if (!user?.identityMapping) return null;
  const actor = actorPerspective(user);
  if (actor === user) return null;
  return getVisibleScope(actor);
}

/** AND the actor's scope onto a filter built for the effective user. */
function withActorScope(filter, actorScope, columns, prefix) {
  if (!actorScope || actorScope.all) return filter;
  const extra = scopeFilter(actorScope, { ...columns, prefix });
  return { sql: `(${filter.sql} AND ${extra.sql})`, inputs: { ...filter.inputs, ...extra.inputs } };
}

/** A native document chain must be inside the scope of both identities. */
async function chainVisibleToBoth(user, effectiveScope, chain) {
  if (!await nativeChainInScope(effectiveScope, chain)) return false;
  const actorScope = await secondaryActorScope(user);
  return !actorScope || nativeChainInScope(actorScope, chain);
}

/** True when both identities see every record (company-wide lists with no owner column). */
async function bothSeeAll(user, effectiveScope) {
  if (!effectiveScope?.all) return false;
  const actorScope = await secondaryActorScope(user);
  return !actorScope || actorScope.all === true;
}

module.exports = { secondaryActorScope, withActorScope, chainVisibleToBoth, bothSeeAll };
