'use client';
import {QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient} from '@tanstack/react-query';
import {useState, type ReactNode} from 'react';
import type {Api} from './api';
export const accessKey = (userId: string) => ['entitlements', userId] as const;
export function QueryProvider({children}: {children: ReactNode}) {const [client] = useState(() => new QueryClient({defaultOptions: {queries: {retry: false, refetchOnWindowFocus: false, staleTime: 5000}, mutations: {retry: false}}})); return <QueryClientProvider client={client}>{children}</QueryClientProvider>;}
export function useEntitlements(api: Api, userId: string | null) {return useQuery({queryKey: accessKey(userId ?? ''), queryFn: api.entitlements, enabled: !!userId, gcTime: 0});}
export function usePublicStatus(api: Api) {return useQuery({queryKey: ['early-access-status'], queryFn: api.status, staleTime: 15000, refetchOnWindowFocus: true});}
export function useAccessMutation<T>(work: (input: T) => Promise<unknown>, userId: string) {const client = useQueryClient(); return useMutation({mutationFn: work, onSuccess: async () => {await client.invalidateQueries({queryKey: accessKey(userId)}); await client.invalidateQueries({queryKey: ['early-access-status']});}});}
