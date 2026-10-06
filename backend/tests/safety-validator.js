'use strict';

/**
 * Re-export pure safety validator from production backend module.
 * Ensures backward-compatibility for any test imports.
 */
module.exports = require('../safety-validator');
