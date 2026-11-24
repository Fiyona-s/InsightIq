"""Stage 1: the installed test benchmark is flagged so owner views can leave it out.

The flag comes only from the explicit benchmark install record, never from a file name,
and listing datasets performs no writes.
"""
from fastapi.testclient import TestClient
from tests.test_phase4 import make_app


def test_benchmark_flag_comes_from_install_record_not_filename(tmp_path):
  with TestClient(make_app(tmp_path)) as client:
    csv = b"id,revenue,region\n1,10,North\n2,20,South\n"
    upload = client.post('/api/datasets', files={'file': ('controlled-benchmark-lookalike.csv', csv, 'text/csv')})
    assert upload.status_code == 201, upload.text
    owner_id = upload.json()['id']
    assert upload.json()['is_benchmark'] is False

    before = client.get('/api/datasets').json()
    assert [d['is_benchmark'] for d in before] == [False]

    installed = client.post('/api/benchmarks/retail-v1/install').json()
    listed = {d['id']: d for d in client.get('/api/datasets?include_archived=true').json()}
    assert listed[installed['dataset_id']]['is_benchmark'] is True
    assert listed[owner_id]['is_benchmark'] is False
    # Single-dataset reads keep the default (no benchmark lookup) and remain unchanged in shape.
    assert 'is_benchmark' in client.get('/api/datasets/' + owner_id).json()


def test_listing_datasets_is_read_only(tmp_path):
  with TestClient(make_app(tmp_path)) as client:
    client.post('/api/datasets', files={'file': ('shop.csv', b"id,revenue\n1,10\n", 'text/csv')})
    client.post('/api/benchmarks/retail-v1/install')
    catalog = tmp_path / 'catalog.sqlite'
    snapshot = catalog.read_bytes()
    for _ in range(3):
        assert client.get('/api/datasets?include_archived=true').status_code == 200
    assert catalog.read_bytes() == snapshot
