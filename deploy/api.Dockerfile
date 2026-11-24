# Hosted API image (Accounts A5). Same application code as backend/Dockerfile; differences: a fixed non-root user, no data
# directory owned at build time (the provision script prepares the company's volume), and the launcher that applies the
# fail-closed start-up rules. Build:  deploy/scripts/build-images.sh
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libseccomp2 fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY scripts ./scripts
COPY benchmarks ./benchmarks
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin insight
USER 10001:10001
ENV DATA_DIR=/data PYTHONPATH=/app PYTHONDONTWRITEBYTECODE=1 HOME=/tmp
EXPOSE 8000
CMD ["python", "-m", "app.serve", "--host", "0.0.0.0", "--port", "8000"]
