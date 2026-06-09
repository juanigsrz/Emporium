from rest_framework import serializers

from .models import ImportJob


class ImportJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = ImportJob
        fields = ["id", "kind", "source_ref", "options", "status",
                  "summary", "result", "log", "created", "updated"]
        read_only_fields = ["id", "status", "summary", "result", "log", "created", "updated"]

    def validate(self, attrs):
        request = self.context["request"]
        kind = attrs.get("kind")
        if kind == ImportJob.Kind.GEEKLIST:
            if not attrs.get("source_ref"):
                raise serializers.ValidationError({"source_ref": "Geeklist id is required."})
        else:
            profile = getattr(request.user, "profile", None)
            if not (profile and profile.bgg_username):
                raise serializers.ValidationError(
                    {"bgg_username": "Set your BGG username on your profile first."}
                )
        return attrs
