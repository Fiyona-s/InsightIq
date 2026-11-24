"""Dedicated sanitized metrics logger, visible under the default Uvicorn setup."""
import logging

metrics_logger = logging.getLogger('insightiq.metrics')
if not metrics_logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
    metrics_logger.addHandler(handler)
metrics_logger.setLevel(logging.INFO)
metrics_logger.propagate = False
