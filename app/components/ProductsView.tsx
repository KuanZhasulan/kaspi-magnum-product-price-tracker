"use client";

import {
  Box,
  Card,
  CardContent,
  CardMedia,
  Chip,
  CircularProgress,
  Grid,
  InputAdornment,
  Pagination,
  TextField,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface Product {
  id: number;
  kaspiId: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  productUrl: string;
  unit: string | null;
  price: number;
  trueDiscount: number;
  scrapedAt: string;
}

interface ApiResponse {
  products: Product[];
  total: number;
  page: number;
  totalPages: number;
}

const PLACEHOLDER_IMG = "/product-placeholder.png";

function formatPrice(price: number) {
  return new Intl.NumberFormat("ru-KZ", {
    style: "currency",
    currency: "KZT",
    maximumFractionDigits: 0,
  }).format(price);
}

export default function ProductsView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [inputValue, setInputValue] = useState(search);
  const [page, setPage] = useState(Number(searchParams.get("page") ?? "1"));
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchProducts = useCallback(async (q: string, p: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("search", q);
      params.set("page", String(p));
      const res = await fetch(`/api/products?${params}`);
      const json: ApiResponse = await res.json();
      setData(json);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Sync URL params → state on mount
  useEffect(() => {
    fetchProducts(search, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(inputValue);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [inputValue]);

  // Fetch when search/page changes
  useEffect(() => {
    fetchProducts(search, page);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (page > 1) params.set("page", String(page));
    router.replace(`?${params}`, { scroll: false });
  }, [search, page, fetchProducts, router]);

  return (
    <Box>
      {/* Search bar */}
      <TextField
        fullWidth
        variant="outlined"
        placeholder="Поиск товаров Magnum…"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon color="action" />
              </InputAdornment>
            ),
          },
        }}
        sx={{ mb: 3 }}
      />

      {/* Status row */}
      {data && !loading && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {data.total === 0
            ? "Ничего не найдено"
            : `Найдено: ${data.total.toLocaleString("ru-RU")} товаров — сортировка по реальной скидке`}
        </Typography>
      )}

      {/* Loading */}
      {loading && (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress />
        </Box>
      )}

      {/* Empty state */}
      {!loading && data?.products.length === 0 && (
        <Box textAlign="center" py={8}>
          <Typography variant="h6" color="text.secondary">
            Товары не найдены
          </Typography>
          <Typography variant="body2" color="text.secondary" mt={1}>
            Попробуйте другой запрос или подождите следующего ежедневного обновления
          </Typography>
        </Box>
      )}

      {/* Product grid */}
      {!loading && (data?.products.length ?? 0) > 0 && (
        <Grid container spacing={2}>
          {data!.products.map((product) => (
            <Grid key={product.id} size={{ xs: 12, sm: 6, md: 4, lg: 3, xl: 2.4 }}>
              <Card
                component="a"
                href={product.productUrl}
                target="_blank"
                rel="noopener noreferrer"
                sx={{
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  textDecoration: "none",
                  transition: "box-shadow 0.2s",
                  "&:hover": { boxShadow: 6 },
                }}
              >
                <CardMedia
                  component="img"
                  image={product.imageUrl ?? PLACEHOLDER_IMG}
                  alt={product.name}
                  sx={{ height: 160, objectFit: "contain", p: 1, bgcolor: "#fafafa" }}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = PLACEHOLDER_IMG;
                  }}
                />
                <CardContent sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
                  {product.trueDiscount > 0 && (
                    <Chip
                      icon={<TrendingDownIcon />}
                      label={`−${product.trueDiscount}% реальная скидка`}
                      color="error"
                      size="small"
                      sx={{ alignSelf: "flex-start" }}
                    />
                  )}
                  <Typography
                    variant="body2"
                    sx={{
                      flex: 1,
                      display: "-webkit-box",
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                      color: "text.primary",
                    }}
                  >
                    {product.name}
                  </Typography>
                  {product.unit && (
                    <Typography variant="caption" color="text.secondary">
                      {product.unit}
                    </Typography>
                  )}
                  <Typography variant="h6" color="primary" fontWeight={700}>
                    {formatPrice(product.price)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Pagination */}
      {!loading && (data?.totalPages ?? 0) > 1 && (
        <Box display="flex" justifyContent="center" mt={4}>
          <Pagination
            count={data!.totalPages}
            page={page}
            onChange={(_, p) => {
              setPage(p);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            color="primary"
            size="large"
          />
        </Box>
      )}
    </Box>
  );
}
