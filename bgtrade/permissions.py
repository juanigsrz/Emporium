from rest_framework import permissions


class IsOwnerOrReadOnly(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        return obj.owner == request.user


class IsOrganizer(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated
                    and hasattr(request.user, 'profile')
                    and request.user.profile.is_organizer)

    def has_object_permission(self, request, view, obj):
        return obj.organizer == request.user
