import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.api.routes import router as api_router
from app.services.llm_service import llm_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("companion.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Verify personality prompt file is available
    logger.info("Initializing Companion FastAPI Backend...")
    try:
        system_instruction = llm_service.get_system_instruction()
        logger.info(
            "Companion personality prompt loaded successfully (%d characters).",
            len(system_instruction),
        )
    except Exception as e:
        logger.warning(
            "Personality prompt warning on boot: %s. Chat requests may fail if prompt is missing.",
            e,
        )

    if settings.gemini_api_key:
        logger.info(
            "Gemini API key is configured. Model: %s",
            settings.gemini_model,
        )
    else:
        logger.warning(
            "No GEMINI_API_KEY detected. Provide GEMINI_API_KEY in backend/.env for live conversational generation."
        )

    yield
    logger.info("Companion Backend shutting down cleanly.")


def create_app() -> FastAPI:
    app = FastAPI(
        title="AI Companion Backend",
        description="FastAPI Backend and Gemini Structured Conversation Engine for 3D VRM Companion",
        version="0.1.0",
        lifespan=lifespan,
    )

    # CORS configuration restricted to local frontend origins
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

    # Mount API routes
    app.include_router(api_router, prefix="/api")

    # Mount frontend static distribution if available (Production / Unified Container mode)
    static_dist_path = settings.get_static_dir()
    if static_dist_path and static_dist_path.is_dir():
        from fastapi.staticfiles import StaticFiles
        from fastapi.responses import FileResponse

        assets_dir = static_dist_path / "assets"
        if assets_dir.is_dir():
            app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

        models_dir = static_dist_path / "models"
        if models_dir.is_dir():
            app.mount("/models", StaticFiles(directory=str(models_dir)), name="models")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def serve_spa(full_path: str):
            requested_file = (static_dist_path / full_path).resolve()
            # Prevent directory traversal attacks
            if requested_file.is_file() and str(requested_file).startswith(str(static_dist_path)):
                return FileResponse(requested_file)
            index_file = static_dist_path / "index.html"
            if index_file.is_file():
                return FileResponse(index_file)
            return {"detail": "Not Found"}

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=True,
    )

