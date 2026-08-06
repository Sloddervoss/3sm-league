# JRES-Solver microservice — build-container
# Compileert jres_solver_cpp (HiGHS via FetchContent, netwerk nodig in BUILDER).
# Produceert een klein runtime-image met alleen de statische binary.
# Build:  docker build -t jres-solver .
# .../  (wordt vanuit de project-root "ops/jres-solver" gedraaid; repo wordt mee gekopieerd)

# ---- Stage 1: build ----
FROM debian:bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
# Kopieer de jres_solver_cpp-repo (volledig, met submodule cxxopts).
COPY jres_solver_cpp/ ./jres_solver_cpp/

RUN cd jres_solver_cpp && \
    cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_FLAGS="-static-libgcc -static-libstdc++" -DBUILD_SHARED_LIBS=OFF -DCMAKE_RUNTIME_OUTPUT_DIRECTORY=/src/jres_solver_cpp/build/bin && \
    cmake --build build -j$(nproc) --target solver

# ---- Stage 2: runtime ----
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /src/jres_solver_cpp/build/bin/jres_solver /usr/local/bin/jres_solver
COPY wrapper.js /usr/local/bin/wrapper.js
# Node voor de wrapper (Node 20)
RUN apt-get update && apt-get install -y --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/*
EXPOSE 8080
ENTRYPOINT ["node", "/usr/local/bin/wrapper.js"]
