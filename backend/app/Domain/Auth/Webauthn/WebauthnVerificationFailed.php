<?php

namespace App\Domain\Auth\Webauthn;

use RuntimeException;

/**
 * A ceremony answer that did not verify: bad signature, wrong origin or rpId,
 * stale challenge, unknown attestation format, malformed payload… The message
 * is the engine's reason and is for the log only; clients get a generic 422.
 */
class WebauthnVerificationFailed extends RuntimeException {}
