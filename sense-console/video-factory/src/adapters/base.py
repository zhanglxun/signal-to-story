"""
Base Adapter: Abstract interface for all image and video generation adapters.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional


class BaseAdapter(ABC):
    def __init__(self, name: str, config: Optional[Dict[str, Any]] = None):
        self.name = name
        self.config = config or {}

    @abstractmethod
    def generate_image(
        self,
        prompt: str,
        output_path: str,
        aspect_ratio: str = "9:16",
        ref_images: Optional[List[str]] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Generate a static image (T2I / I2I).
        Returns: { "success": bool, "output_path": str, "cost": float, "error": Optional[str] }
        """
        pass

    @abstractmethod
    def generate_video(
        self,
        prompt: str,
        output_path: str,
        first_frame: Optional[str] = None,
        duration_sec: float = 5.0,
        aspect_ratio: str = "9:16",
        ref_images: Optional[List[str]] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Generate a video shot (T2V / I2V / Local Motion).
        Returns: { "success": bool, "output_path": str, "cost": float, "error": Optional[str] }
        """
        pass

    def estimate_cost(self, mode: str, duration_sec: float = 5.0) -> float:
        """
        Estimate the cost in RMB (CNY) for this operation. Default is 0.0.
        """
        return 0.0
