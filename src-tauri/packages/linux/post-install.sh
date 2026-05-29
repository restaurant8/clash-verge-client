#!/bin/bash
chmod +x /usr/bin/muacloud-service-install
chmod +x /usr/bin/muacloud-service-uninstall
chmod +x /usr/bin/muacloud-service

. /etc/os-release

if [ "$ID" = "deepin" ]; then
    PACKAGE_NAME="$DPKG_MAINTSCRIPT_PACKAGE"
    DESKTOP_FILES=$(dpkg -L "$PACKAGE_NAME" 2>/dev/null | grep "\.desktop$")
    echo "$DESKTOP_FILES" | while IFS= read -r f; do
        if [ "$(basename "$f")" == "MuaCloud.desktop" ]; then
            echo "Fixing deepin desktop file"
            mv -vf "$f" "/usr/share/applications/muacloud.desktop"
        fi
    done
fi
