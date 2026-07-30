FROM e2bdev/base@sha256:4a369f01a820fe5e65f53c2c5727a78899daf86f0541b721097f289559c8b73f

USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
WORKDIR /opt/benchmax
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npx playwright install --with-deps chromium \
  && FFMPEG_PATH="$(find /opt/ms-playwright -type f -name ffmpeg-linux -print -quit)" \
  && test -n "$FFMPEG_PATH" \
  && ln -s "$FFMPEG_PATH" /usr/local/bin/benchmax-ffmpeg \
  && mkdir -p /workspace/input /workspace/output /workspace/project \
  && chown -R user:user /workspace /opt/ms-playwright
COPY evaluate.mjs ./evaluate.mjs
COPY e2b.Dockerfile ./e2b.Dockerfile.locked
RUN { \
    sha256sum package-lock.json; \
    sha256sum evaluate.mjs; \
    sha256sum e2b.Dockerfile.locked; \
  } | sha256sum | cut -d ' ' -f 1 > /opt/benchmax/environment.sha256
RUN chmod 0555 /opt/benchmax/evaluate.mjs \
  && chmod 0444 /opt/benchmax/environment.sha256 \
  && chmod 0777 /workspace/input /workspace/output /workspace/project
USER user
