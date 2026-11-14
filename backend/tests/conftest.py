import os
import sys
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp(prefix="devsecure-test-"))
os.environ["DEVSECURE_DATA_DIR"] = str(_tmp / "data")
os.environ["DEVSECURE_WORKSPACES_DIR"] = str(_tmp / "workspaces")
os.environ["DEVSECURE_BUS_SECRET"] = "test-secret"
os.environ["DEVSECURE_PACING_MS"] = "0"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
