# Both runtime images are pinned to the recorded, locally cached image digests.
# No dependency download, vendor entrypoint or privilege escalation at runtime.
FROM denoland/deno@sha256:fa335acdf6b72106eda2cb6a8cb5f4187e7630e357467489db4b2e7352d5e432 AS deno
FROM supabase/postgres@sha256:1aabcd9cfb8a58ecde50a6092b207bcbb5f6bdc45546fde35cfda5d3ab39c065
COPY --from=deno /usr/bin/deno /usr/local/bin/deno
WORKDIR /app
COPY workers/pitwall-learning /app/workers/pitwall-learning
COPY src/features/endurance/pitwall/learning /app/src/features/endurance/pitwall/learning
COPY src/features/endurance/pitwall/strategy /app/src/features/endurance/pitwall/strategy
ENV DENO_DIR=/tmp/deno-cache HOME=/tmp PGUSER=pitwall_learning_worker PSQL_BIN=/nix/var/nix/profiles/default/bin/psql
USER 100:101
# Supabase's Alpine/Nix image has no global glibc loader. Use its pinned glibc
# explicitly; do not add an unpinned libc package or change the DB container.
ENTRYPOINT ["/nix/store/j193mfi0f921y0kfs8vjc1znnr45ispv-glibc-2.40-66/lib/ld-linux-x86-64.so.2","--library-path","/nix/store/j193mfi0f921y0kfs8vjc1znnr45ispv-glibc-2.40-66/lib:/nix/store/0p8b2lqk47fvxm9hc6c8mnln5l8x51q1-gcc-14.3.0-lib/lib","/usr/local/bin/deno","run","--no-config","--unstable-sloppy-imports","--cached-only","--allow-env=PGUSER,PGHOST,PGDATABASE,PSQL_BIN","--allow-run=/nix/var/nix/profiles/default/bin/psql","/app/workers/pitwall-learning/main.ts"]
CMD []
