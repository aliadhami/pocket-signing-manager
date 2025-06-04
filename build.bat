@echo off
echo Building pocket-signing-manager...
cd /d "%~dp0"
node "./node_modules/typescript/lib/tsc.js" -p .
if %errorlevel% equ 0 (
    echo Build completed successfully!
) else (
    echo Build failed with error code %errorlevel%
)