from rest_framework import generics, permissions
from rest_framework.response import Response

from .models import ImportJob
from .serializers import ImportJobSerializer
from .tasks import process_import_job


class ImportJobListCreateView(generics.ListCreateAPIView):
    serializer_class = ImportJobSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return ImportJob.objects.filter(user=self.request.user)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        job = serializer.save(user=request.user)
        process_import_job.delay(job.id)  # eager in dev/test
        job.refresh_from_db()
        out = self.get_serializer(job)
        return Response(out.data, status=201)


class ImportJobDetailView(generics.RetrieveAPIView):
    serializer_class = ImportJobSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return ImportJob.objects.filter(user=self.request.user)
