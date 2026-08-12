"""Report construction, validation, submission - and the mock receiver."""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from sqlalchemy import select

from ..deps import SessionDep, UserDep, require
from ..models import Case, Report, ReportType, User
from ..schemas import BuildReportRequest
from ..serializers import report_json
from ..services import mock_fintrac, report_builder, str_copilot, validation

router = APIRouter(prefix="/api", tags=["reports"])


# ---------------------------------------------------------------------------
# Building
# ---------------------------------------------------------------------------


@router.post("/cases/{case_id}/reports")
def build_report(
    case_id: int,
    body: BuildReportRequest,
    session: SessionDep,
    actor: User = Depends(require("report:build")),
) -> dict:
    case = session.get(Case, case_id)
    if case is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "case not found")

    narrative = None
    citations = None
    verification = None
    if body.report_type is ReportType.STR or body.include_narrative:
        draft, result = str_copilot.draft_for_case(session, case)
        narrative, citations, verification = draft.text, draft.citations(), result.as_dict()

    try:
        report = report_builder.build_report(
            session, case, body.report_type, actor=actor, narrative=narrative, citations=citations
        )
    except report_builder.ReportBuildError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    session.commit()
    payload = report_json(report, include_payload=True)
    payload["narrative_verification"] = verification
    return payload


@router.get("/reports")
def list_reports(
    session: SessionDep,
    _: UserDep,
    case_id: int | None = None,
    report_type: ReportType | None = None,
    limit: int = Query(100, ge=1, le=500),
) -> dict:
    stmt = select(Report)
    if case_id:
        stmt = stmt.where(Report.case_id == case_id)
    if report_type:
        stmt = stmt.where(Report.report_type == report_type)
    rows = session.execute(stmt.order_by(Report.id.desc()).limit(limit)).scalars().all()
    return {"reports": [report_json(r) for r in rows]}


@router.get("/reports/{report_id}")
def get_report(report_id: int, session: SessionDep, _: UserDep) -> dict:
    report = session.get(Report, report_id)
    if report is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "report not found")
    return report_json(report, include_payload=True)


@router.get("/reports/{report_id}/download")
def download_report(report_id: int, session: SessionDep, _: UserDep) -> JSONResponse:
    """The FINTRAC payload as a downloadable file.

    The reference implementation made the user select-all and copy the JSON out
    of a textarea; this is that gap closed.
    """
    report = session.get(Report, report_id)
    if report is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "report not found")
    filename = f"{report.report_reference}.json"
    return JSONResponse(
        content=report.payload or {},
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/reports/{report_id}/validate")
def validate_report(
    report_id: int,
    session: SessionDep,
    actor: User = Depends(require("report:build")),
) -> dict:
    report = session.get(Report, report_id)
    if report is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "report not found")
    report_builder.revalidate(session, report, actor=actor)
    session.commit()
    return {"status": report.status.value, "validation": report.validation}


@router.post("/reports/validate-payload")
def validate_payload(
    payload: dict = Body(...),
    levels: str = Query("1,2,3,4"),
    _: UserDep = None,
) -> dict:
    """Validate an arbitrary LVCTR payload without persisting anything.

    This is the "validation lab" surface: paste a report, get the errors before
    it goes anywhere.
    """
    try:
        chosen = tuple(int(part) for part in levels.split(",") if part.strip())
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "levels must be comma-separated integers") from exc
    return validation.validate(payload, levels=chosen).as_dict()


# ---------------------------------------------------------------------------
# Submission
# ---------------------------------------------------------------------------


@router.post("/reports/{report_id}/submit")
def submit_report(
    report_id: int,
    session: SessionDep,
    actor: User = Depends(require("report:submit")),
) -> dict:
    report = session.get(Report, report_id)
    if report is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "report not found")
    try:
        submission = mock_fintrac.submit(session, report, actor)
    except mock_fintrac.SubmissionBlocked as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    session.commit()
    return {
        "report": report_json(report),
        "submission": {
            "request_id": submission.request_id,
            "response_status": submission.response_status,
            "submission_id": submission.submission_id,
            "response": submission.response,
        },
    }


# ---------------------------------------------------------------------------
# Mock receiver (stands in for a regulatory endpoint)
# ---------------------------------------------------------------------------

mock_router = APIRouter(prefix="/api/mock-fintrac", tags=["mock-fintrac"])


@mock_router.post("/reports/lvctr")
def receive_lvctr(payload: dict = Body(...)) -> dict:
    """SIMULATED. Applies the receiver's own validation and returns its verdict."""
    return mock_fintrac.receive(payload, ReportType.LVCTR.value).as_dict()


@mock_router.post("/reports/str")
def receive_str(payload: dict = Body(...)) -> dict:
    """SIMULATED."""
    return mock_fintrac.receive(payload, ReportType.STR.value).as_dict()
