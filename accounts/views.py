from django.contrib.auth import authenticate, login, logout
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response

from .serializers import RegisterSerializer, LoginSerializer, UserProfileSerializer, BGGLinkSerializer
from catalog import bgg as bgg_service


def _profile_response(user):
    return UserProfileSerializer(user.profile).data


@api_view(['POST'])
@permission_classes([AllowAny])
def register(request):
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.save()
    token, _ = Token.objects.get_or_create(user=user)
    return Response({'token': token.key, 'profile': _profile_response(user)},
                    status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([AllowAny])
def user_login(request):
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = authenticate(request,
                        username=serializer.validated_data['username'],
                        password=serializer.validated_data['password'])
    if user is None:
        return Response({'detail': 'Invalid credentials.'}, status=status.HTTP_401_UNAUTHORIZED)
    login(request, user)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({'token': token.key, 'profile': _profile_response(user)})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def user_logout(request):
    logout(request)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated])
def me(request):
    if request.method == 'GET':
        return Response(_profile_response(request.user))
    profile = request.user.profile
    for field in ['default_country', 'default_region', 'timezone']:
        if field in request.data:
            setattr(profile, field, request.data[field])
    profile.save()
    return Response(_profile_response(request.user))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def bgg_link(request):
    from django.conf import settings
    serializer = BGGLinkSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    profile = request.user.profile
    profile.bgg_username = serializer.validated_data['bgg_username']
    # Auto-verify when BGG API auth is not configured.
    profile.bgg_verified = not getattr(settings, 'BGG_VERIFICATION_ENABLED', True)
    profile.save()
    return Response(_profile_response(request.user))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def bgg_verify(request):
    from django.conf import settings
    profile = request.user.profile
    if not profile.bgg_username:
        return Response({'detail': 'No BGG username linked.'}, status=status.HTTP_400_BAD_REQUEST)
    if not getattr(settings, 'BGG_VERIFICATION_ENABLED', True):
        profile.bgg_verified = True
        profile.save()
        return Response(_profile_response(request.user))
    user_data = bgg_service.get_user(profile.bgg_username)
    if user_data is None:
        return Response(
            {'detail': 'BGG user not found or BGG API is unavailable.'},
            status=status.HTTP_404_NOT_FOUND,
        )
    profile.bgg_verified = True
    profile.save()
    return Response(_profile_response(request.user))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def bgg_import(request):
    profile = request.user.profile
    if not profile.bgg_username:
        return Response({'detail': 'No BGG username linked.'}, status=status.HTTP_400_BAD_REQUEST)
    result = bgg_service.import_collection(request.user, profile.bgg_username)
    return Response(result)
