FROM e2bdev/base:latest

USER root
RUN npm install --global playwright@1.55.0 axe-core@4.10.3 \
  && npx playwright install --with-deps chromium \
  && mkdir -p /opt/benchmax /workspace/input /workspace/output /workspace/project
COPY evaluate.mjs /opt/benchmax/evaluate.mjs
RUN chmod 0555 /opt/benchmax/evaluate.mjs \
  && chmod 0777 /workspace/input /workspace/output /workspace/project
USER user
