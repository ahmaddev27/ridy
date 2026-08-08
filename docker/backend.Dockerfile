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

# --- Application -------------------------------------------------------------
# Copy the Laravel app, then install production dependencies. The Compose
# `backend` service bind-mounts ./backend over this at runtime for local dev;
# baking the install in keeps the image runnable on its own (CI / prod).
COPY backend/ /var/www/

RUN composer install --no-dev --optimize-autoloader --no-interaction --prefer-dist \
    && chown -R www-data:www-data /var/www/storage /var/www/bootstrap/cache

# PHP-FPM listens on 9000; nginx (separate service) proxies FastCGI to it.
EXPOSE 9000

CMD ["php-fpm"]
