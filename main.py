from __future__ import annotations

import asyncio
import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from types import MethodType
from typing import Any, Final

try:
    from dotenv import load_dotenv  # type: ignore
except ModuleNotFoundError:
    load_dotenv = lambda: None  # noqa: E731

import httpx
from fastmcp import FastMCP
from fastmcp.server.openapi import (
    HTTPRoute,
    MCPType,
    OpenAPIResource,
    OpenAPIResourceTemplate,
    OpenAPITool,
)
from fastmcp.tools.tool import ToolResult
from fastmcp.utilities.types import Audio

PROJECT_ROOT: Final = Path(__file__).resolve().parent
OPENAPI_PATH: Final = PROJECT_ROOT / "openapi.json"
DEFAULT_BASE_URL: Final = "https://api.aivis-project.com"
API_KEY_ENV: Final = "AIVIS_API_KEY"
DEFAULT_SERVER_NAME: Final = "aivis-cloud"

ALLOWED_OPERATIONS: Final = {
    ("/v1/tts/synthesize", "POST"),
    ("/v1/users/me", "GET"),
}
BINARY_CONTENT_PREFIXES: Final = ("audio/", "video/")
CONTENT_TYPE_EXTENSIONS: Final = {
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/aac": ".aac",
    "audio/ogg": ".ogg",
    "audio/ogg; codecs=opus": ".ogg",
    "audio/flac": ".flac",
    "audio/mp4": ".m4a",
}
DEFAULT_MODEL_UID_ENV: Final = "AIVIS_DEFAULT_MODEL_UID"

def _load_openapi_spec() -> dict:
    try:
        raw = OPENAPI_PATH.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise RuntimeError(f"OpenAPI 定義が見つかりません: {OPENAPI_PATH}") from exc

    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("OpenAPI 定義の JSON パースに失敗しました") from exc


def _read_api_key() -> str:
    api_key = os.getenv(API_KEY_ENV)
    if not api_key:
        raise RuntimeError(f"環境変数 {API_KEY_ENV} が設定されていません")
    return api_key

def _route_map(route: HTTPRoute, mcp_type: MCPType) -> MCPType | None:
    candidate = (route.path, route.method.upper())
    if candidate not in ALLOWED_OPERATIONS:
        return MCPType.EXCLUDE
    return mcp_type


def _customize_component(
    route: HTTPRoute,
    component: OpenAPITool | OpenAPIResource | OpenAPIResourceTemplate,
) -> None:
    component.tags.add("aivis")
    component.tags.add("tts")
    for tag in route.tags:
        component.tags.add(tag.lower())

    summary = route.summary or route.operation_id or f"{route.method.lower()} {route.path}"
    if hasattr(component, "description") and summary:
        current = getattr(component, "description")
        if current:
            component.description = f"{current}\n\n【概要】{summary}"
        else:
            component.description = summary

    if route.path == "/v1/tts/synthesize" and hasattr(component, "parameters"):
        params = component.parameters
        if isinstance(params, dict):
            props = params.setdefault("properties", {})
            props.setdefault(
                "model_uid",
                {
                    "type": "string",
                    "title": "モデル UID",
                    "description": (
                        "モデルの UUID または検索キーワードを指定すると、自動的に model_uuid を補完します。"
                    ),
                },
            )
            required = params.get("required")
            if isinstance(required, list) and "model_uid" in required:
                required.remove("model_uid")

        if hasattr(component, "output_schema"):
            component.output_schema = None

    if route.path == "/v1/users/me" and hasattr(component, "output_schema"):
        component.output_schema = None

    if _route_has_binary_success(route) and hasattr(component, "run"):
        object.__setattr__(component, "run", MethodType(_run_binary_openapi_tool, component))

def _route_has_binary_success(route: HTTPRoute) -> bool:
    for status_code, response in route.responses.items():
        if not status_code or not status_code.startswith(("2", "3")):
            continue
        for media_type, schema in response.content_schema.items():
            if any(media_type.startswith(prefix) for prefix in BINARY_CONTENT_PREFIXES):
                if isinstance(schema, dict):
                    if schema.get("format") == "binary" or schema.get("type") == "string":
                        return True
    return False


def _save_binary_response(content_type: str, data: bytes) -> Path:
    extension = CONTENT_TYPE_EXTENSIONS.get(content_type, ".bin")
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
    filename = f"aivis_{timestamp}{extension}"
    output_dir = Path.cwd() / "aivis"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / filename
    output_path.write_bytes(data)
    return output_path

async def _prepare_model_arguments(
    client: httpx.AsyncClient, payload: dict[str, Any], timeout: float | None
) -> dict[str, Any] | None:
    if payload.get("model_uuid"):
        payload.pop("model_uid", None)
        return None

    alias = payload.pop("model_uid", None)
    if not alias:
        alias = os.getenv(DEFAULT_MODEL_UID_ENV)
        if not alias:
            return None

    alias_str = str(alias).strip()
    if not alias_str:
        return None

    try:
        uuid.UUID(alias_str)
    except ValueError:
        metadata = await _search_model_metadata(client, alias_str, timeout)
        if metadata is None:
            raise ValueError(f"指定されたモデルが見つかりません: {alias_str}")
        payload["model_uuid"] = metadata.get("aivm_model_uuid")

        if not payload.get("speaker_uuid"):
            speakers = metadata.get("speakers") or []
            if speakers:
                speaker_uuid = speakers[0].get("aivm_speaker_uuid")
                if speaker_uuid:
                    payload["speaker_uuid"] = speaker_uuid
        return metadata

    payload["model_uuid"] = alias_str
    return {"aivm_model_uuid": alias_str}


async def _search_model_metadata(
    client: httpx.AsyncClient, keyword: str, timeout: float | None
) -> dict[str, Any] | None:
    params = {"keyword": keyword, "limit": 1}
    response = await client.get(
        "/v1/aivm-models/search",
        params=params,
        timeout=timeout or 30.0,
    )
    response.raise_for_status()
    data = response.json()
    models = data.get("aivm_models") or []
    if not models:
        return None
    return models[0]

async def _run_binary_openapi_tool(self: OpenAPITool, arguments: dict[str, Any]) -> ToolResult:
    payload = {k: v for k, v in arguments.items() if v is not None}

    model_metadata = await _prepare_model_arguments(self._client, payload, self._timeout)

    try:
        response = await self._client.request(
            method=self._route.method,
            url=self._route.path,
            json=payload if payload else None,
            timeout=self._timeout,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        message = f"HTTP error {exc.response.status_code}: {exc.response.reason_phrase}"
        try:
            error_data = exc.response.json()
            message += f" - {error_data}"
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
            if exc.response.text:
                message += f" - {exc.response.text}"
        raise ValueError(message) from exc
    except httpx.RequestError as exc:
        raise ValueError(f"Request error: {exc}") from exc

    content_type = (response.headers.get("content-type") or "").split(";")[0].strip()
    if any(content_type.startswith(prefix) for prefix in BINARY_CONTENT_PREFIXES):
        audio = Audio(data=response.content)
        saved_path = _save_binary_response(content_type, response.content)
        structured = {
            "content_type": content_type or "application/octet-stream",
            "size_bytes": len(response.content),
            "file_path": str(saved_path),
        }
        model_uuid = payload.get("model_uuid")
        if model_uuid:
            structured["model_uuid"] = model_uuid
        if model_metadata:
            structured["model"] = {
                "uuid": model_metadata.get("aivm_model_uuid"),
                "name": model_metadata.get("name"),
                "speakers": [s.get("aivm_speaker_uuid") for s in model_metadata.get("speakers", [])],
            }
        return ToolResult(
            content=[audio.to_audio_content(mime_type=content_type or None)],
            structured_content=structured,
        )

    try:
        result = response.json()
        if isinstance(result, dict):
            structured_output = result
        else:
            structured_output = {"result": result}
        return ToolResult(structured_content=structured_output)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return ToolResult(content=response.text)
    
def _create_http_client(api_key: str) -> httpx.AsyncClient:
    base_url = os.getenv("AIVIS_API_BASE_URL", DEFAULT_BASE_URL)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "*/*",
        "User-Agent": "avis-mcp/0.1",
    }
    timeout = httpx.Timeout(connect=10.0, read=60.0, write=60.0, pool=None)
    return httpx.AsyncClient(base_url=base_url, headers=headers, timeout=timeout)


def main() -> None:
    if not os.getenv(API_KEY_ENV):
        load_dotenv()

    openapi_spec = _load_openapi_spec()
    api_key = _read_api_key()
    client = _create_http_client(api_key)

    server_name = os.getenv("AIVIS_MCP_SERVER_NAME", DEFAULT_SERVER_NAME)

    mcp = FastMCP.from_openapi(
        openapi_spec=openapi_spec,
        client=client,
        name=server_name,
        tags={"aivis", "tts"},
        route_map_fn=_route_map,
        mcp_component_fn=_customize_component,
    )

    transport = os.getenv("AIVIS_MCP_TRANSPORT", "stdio").lower()
    run_kwargs: dict[str, object] = {}

    if transport == "http":
        port_str = os.getenv("AIVIS_MCP_PORT", "8000")
        try:
            port = int(port_str)
        except ValueError as exc:
            raise RuntimeError(f"AIVIS_MCP_PORT は整数で指定してください: {port_str}") from exc
        run_kwargs["transport"] = "http"
        run_kwargs["port"] = port
    else:
        run_kwargs["transport"] = "stdio"

    try:
        mcp.run(**run_kwargs)
    finally:
        asyncio.run(client.aclose())


if __name__ == "__main__":
    main()
