"""Proje kök dizinini sys.path'e ekler (paperbot importu için)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
