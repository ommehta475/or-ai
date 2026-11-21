from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field

from app.auth import AuthenticatedUser, get_current_user
from app.config import Settings, get_settings
from app.database import (
    create_conversation,
    delete_conversation,
    get_conversation,
    list_conversations,
    list_messages,
)

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


class CreateConversationRequest(BaseModel):
    title: Optional[str] = Field(default="New Conversation", max_length=120)


@router.get("")
async def get_conversations(
    current_user: AuthenticatedUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    conversations = await list_conversations(
        user_id=current_user.id,
        access_token=current_user.access_token,
        settings=settings,
    )
    return {"conversations": conversations}


@router.post("", status_code=status.HTTP_201_CREATED)
async def post_conversation(
    body: CreateConversationRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    conversation = await create_conversation(
        user_id=current_user.id,
        title=body.title or "New Conversation",
        access_token=current_user.access_token,
        settings=settings,
    )
    return {"conversation": conversation}


@router.get("/{conversation_id}")
async def get_conversation_detail(
    conversation_id: UUID,
    current_user: AuthenticatedUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    conv_id = str(conversation_id)
    conversation = await get_conversation(
        conversation_id=conv_id,
        user_id=current_user.id,
        access_token=current_user.access_token,
        settings=settings,
    )
    messages = await list_messages(
        conversation_id=conv_id,
        user_id=current_user.id,
        access_token=current_user.access_token,
        settings=settings,
    )
    return {"conversation": conversation, "messages": messages}


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_conversation(
    conversation_id: UUID,
    current_user: AuthenticatedUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    await delete_conversation(
        conversation_id=str(conversation_id),
        user_id=current_user.id,
        access_token=current_user.access_token,
        settings=settings,
    )
    return None
