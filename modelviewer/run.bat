@echo off
setlocal enabledelayedexpansion
set "SCRIPT_DIR=%~dp0"
set "VENV=%SCRIPT_DIR%.venv"
set "PYTHON=%VENV%\Scripts\python.exe"
set "REQ=%SCRIPT_DIR%requirements.txt"
set "LOG=%SCRIPT_DIR%viewer_launch.log"

echo [3D Viewer] Starting launcher... > "%LOG%"

if not exist "%PYTHON%" (
    echo [3D Viewer] Creating virtual environment... >> "%LOG%"
    python -m venv "%VENV%" >> "%LOG%" 2>&1
    if not exist "%PYTHON%" (
        py -3 -m venv "%VENV%" >> "%LOG%" 2>&1
    )
)

if exist "%PYTHON%" (
    if not exist "%VENV%\.deps_installed" (
        echo [3D Viewer] Installing dependencies... >> "%LOG%"
        "%PYTHON%" -m pip install --quiet -r "%REQ%" pythonnet >> "%LOG%" 2>&1
        type nul > "%VENV%\.deps_installed"
    )
    echo [3D Viewer] Launching viewer_app.py... >> "%LOG%"
    "%PYTHON%" "%SCRIPT_DIR%src\viewer_app.py" %* >> "%LOG%" 2>&1
    exit /b %errorlevel%
) else (
    echo [3D Viewer] Python virtual environment could not be created. Trying system python... >> "%LOG%"
    python -m pip install --quiet -r "%REQ%" pythonnet >> "%LOG%" 2>&1
    python "%SCRIPT_DIR%src\viewer_app.py" %* >> "%LOG%" 2>&1
    if errorlevel 1 (
        py -3 "%SCRIPT_DIR%src\viewer_app.py" %* >> "%LOG%" 2>&1
    )
    if errorlevel 1 (
        echo [3D Viewer] Python is not installed or not in PATH. >> "%LOG%"
        mshta "javascript:alert('Для работы 3D-просмотра требуется установленный Python 3. Пожалуйста, установите Python с python.org и отметьте галочку Add Python to PATH.');close();"
        exit /b 1
    )
    exit /b %errorlevel%
)
