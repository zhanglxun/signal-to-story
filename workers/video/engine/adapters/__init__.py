"""
Model Adapters Package
"""

from .base import BaseAdapter
from .local_kenburns import LocalKenBurnsAdapter
from .wanx import WanxAdapter

__all__ = ["BaseAdapter", "LocalKenBurnsAdapter", "WanxAdapter"]
