"""Local sentence-transformers embeddings. No runtime downloads or fake fallback."""
import os
import threading
from pathlib import Path
from typing import List, Protocol

import numpy as np


class EmbeddingUnavailable(RuntimeError):
    pass


class Embedder(Protocol):
    @property
    def identity(self) -> str: ...
    def encode(self, texts: List[str]) -> np.ndarray: ...


class SentenceEmbedder:
    def __init__(self, path: Path):
        self.path = path.resolve()
        self._model = None
        self._lock = threading.Lock()

    @property
    def identity(self):
        marker = self.path / 'insightiq-model.json'
        if not marker.is_file():
            return 'sentence-transformers:unprovisioned'
        import hashlib
        return 'sentence-transformers:' + hashlib.sha256(marker.read_bytes()).hexdigest()

    def encode(self, texts):
        if not (self.path / 'insightiq-model.json').is_file():
            raise EmbeddingUnavailable('Local embedding model is not provisioned. Run backend/scripts/provision_embeddings.py; direct schema analysis remains available.')
        if len(texts) > 256 or any(len(t) > 3000 for t in texts):
            raise EmbeddingUnavailable('Embedding input exceeds the document budget.')
        with self._lock:
            try:
                if self._model is None:
                    # Prevent runtime downloads, remote Python code, and external tracing.
                    os.environ.setdefault('HF_HUB_OFFLINE', '1')
                    os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')
                    from sentence_transformers import SentenceTransformer
                    import torch
                    torch.set_num_threads(1)
                    self._model = SentenceTransformer(str(self.path), device='cpu', local_files_only=True,
                                                      trust_remote_code=False, model_kwargs={'use_safetensors': True})
                vectors = self._model.encode(texts, normalize_embeddings=True, convert_to_numpy=True,
                                             batch_size=16, show_progress_bar=False)
                return np.asarray(vectors, dtype='float32')
            except Exception as exc:
                raise EmbeddingUnavailable('Local embedding inference failed. Check model files and the CPU memory budget; no synthetic embeddings were substituted.') from exc
