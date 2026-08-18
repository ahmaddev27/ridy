# syntax=docker/dockerfile:1
#
# DASHCAM backend image (Laravel 13 / PHP 8.3, PHP-FPM).
# Used by the `backend`, `horizon` and `scheduler` Compose services.
#
# Build context is the repository root; this Dockerfile lives in ./docker.
# Production target DB is MySQL 8 (local dev uses sqlite — see README).

FROM php:8.4-fpm AS base

# --- System dependencies -----------------------------------------------------
# Only what the PHP extensions below need at build time; cleaned afterwards to
# keep the image small.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        unzip \
        libzip-dev \
        libicu-dev \
        libonig-dev \
    && rm -rf /var/lib/apt/lists/*

# --- PHP extensions ----------------------------------------------------------
# pdo_mysql : MySQL 8 driver (production database)
# bcmath    : precise numeric calculations
# zip       : composer package extraction / archive handling
# intl      : i18n (German + English), locale-aware formatting
RUN docker-php-ext-configure intl \
    && docker-php-ext-install -j"$(nproc)" pdo_mysql bcmath zip intl

# redis : phpredis client for queues / cache / Horizon (installed via PECL)
RUN pecl install redis \
    && docker-php-ext-enable redis

# --- Composer ----------------------------------------------------------------
# Pulled from the official composer image to pin a known, verified binary.
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www

# --- Dependencies (cached layer) --------------------------------------------
# Install PHP deps from ONLY composer.json + composer.lock first, so this heavy
# layer is cached and re-runs ONLY when dependencies actually change — a
# code-only deploy skips it entirely. That both speeds deploys and avoids
# GitHub codeload's anonymous 429 rate-limit firing on every build.
# Retry with backoff so a transient 429 (on a genuine dep change) self-heals.
COPY backend/composer.json backend/composer.lock /var/www/
RUN for i in 1 2 3 4 5 6 7 8; do \
        composer install --no-dev --no-scripts --no-autoloader --no-interaction --prefer-dist && break; \
        echo "composer install failed (attempt $i) — retrying in 30s..."; sleep 30; \
    done \
    && composer install --no-dev --no-scripts --no-autoloader --no-interaction --prefer-dist

# --- Application -------------------------------------------------------------
# Now the app code + the optimized autoloader. The Compose `backend` service
# bind-mounts ./backend over this at runtime (with a named vendor volume), so
# baking the install in keeps the image runnable on its own (CI / prod).
COPY backend/ /var/www/
RUN composer dump-autoload --no-dev --optimize \
    && chown -R www-data:www-data /var/www/storage /var/www/bootstrap/cache

# PHP-FPM listens on 9000; nginx (separate service) proxies FastCGI to it.
EXPOSE 9000

CMD ["php-fpm"]
