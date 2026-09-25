@echo off
REM Node.js is not installed standalone on this machine, but VS Code ships
REM Electron with Node v20 inside. ELECTRON_RUN_AS_NODE=1 turns Code.exe
REM into a plain node binary.
REM Usage:  node.cmd scripts\run-headless.js --ticks=3000 --seeds=1..8
setlocal
set ELECTRON_RUN_AS_NODE=1
"%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" %*
endlocal & exit /b %errorlevel%
