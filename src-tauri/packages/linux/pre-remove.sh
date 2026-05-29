#!/bin/bash
/usr/bin/muacloud-service-uninstall

. /etc/os-release

if [ "$ID" = "deepin" ]; then
    if [ -f "/usr/share/applications/muacloud.desktop" ]; then
        echo "Removing deepin desktop file"
        rm -vf "/usr/share/applications/muacloud.desktop"
    fi
fi

