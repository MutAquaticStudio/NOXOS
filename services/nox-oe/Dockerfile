FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir .

USER 65532:65532
EXPOSE 8080
CMD ["uvicorn", "nox_oe.app:app", "--host", "0.0.0.0", "--port", "8080"]
