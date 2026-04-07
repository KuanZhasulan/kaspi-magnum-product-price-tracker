import { Box, Container, Divider, Typography } from "@mui/material";
import { Suspense } from "react";
import ProductsView from "./components/ProductsView";

export default function Home() {
  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Box mb={4}>
        <Typography variant="h4" fontWeight={700} color="primary">
          Kaspi × Magnum — трекер цен
        </Typography>
        <Typography variant="body1" color="text.secondary" mt={0.5}>
          30 000+ продуктов. Ежедневное обновление. Сортировка по реальной скидке
          (текущая цена vs максимум за 30 дней).
        </Typography>
      </Box>
      <Divider sx={{ mb: 3 }} />
      <Suspense>
        <ProductsView />
      </Suspense>
    </Container>
  );
}
